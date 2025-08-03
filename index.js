const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const schedule = require('node-schedule');

// ==== CONFIGURARE MONGODB ====
const mongoUri = process.env.MONGODB_URI;
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ Conectat la MongoDB"))
    .catch(err => console.error("❌ Eroare MongoDB:", err));

// ==== CONFIGURARE GOOGLE DRIVE ====
const client_id = process.env.GOOGLE_CLIENT_ID;
const client_secret = process.env.GOOGLE_CLIENT_SECRET;
const redirect_uris = [process.env.GOOGLE_REDIRECT_URI];
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const TOKEN_PATH = 'token.json';

// Funcție pentru salvarea token-ului
function storeToken(token) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
    console.log('✅ Token salvat în', TOKEN_PATH);
}

// Autorizare Google Drive
async function authorizeGoogleDrive() {
    if (process.env.GOOGLE_TOKEN_JSON) {
        oAuth2Client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN_JSON));
        return;
    }

    if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return;
    }

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive']
    });
    console.log('🔗 Deschide acest link pentru a autoriza accesul la Google Drive:\n', authUrl);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('📥 Introdu codul primit de la Google aici: ', async (code) => {
        try {
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            storeToken(tokens);
            rl.close();
        } catch (err) {
            console.error('❌ Eroare la obținerea tokenului:', err);
            rl.close();
        }
    });
}

const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// Funcție pentru a lua prima imagine din folder
async function getFirstImageFromFolder(folderId) {
    const res = await drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/'`,
        orderBy: 'createdTime asc',
        pageSize: 1,
        fields: 'files(id, name)'
    });
    if (!res.data.files.length) throw new Error('Folderul nu conține imagini!');
    return res.data.files[0];
}

// Descărcare imagine din Google Drive
async function downloadImage(fileId, destPath) {
    const dest = fs.createWriteStream(destPath);
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
        res.data
            .on('end', resolve)
            .on('error', reject)
            .pipe(dest);
    });
}

// Mutarea fișierului într-un alt folder
async function moveFileToFolder(fileId, targetFolderId) {
    const file = await drive.files.get({
        fileId: fileId,
        fields: 'parents'
    });
    const previousParents = file.data.parents.join(',');
    await drive.files.update({
        fileId: fileId,
        addParents: targetFolderId,
        removeParents: previousParents,
        fields: 'id, parents'
    });
    console.log(`📦 Fișier mutat în folderul cu ID: ${targetFolderId}`);
}

// ==== CONFIGURARE WHATSAPP cu RemoteAuth ====
const store = new MongoStore({ mongoose: mongoose });

const client = new Client({
    authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000 // sincronizare backup la fiecare 5 minute
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('📱 Scanează acest cod QR cu WhatsApp!');
});

client.on('ready', async () => {
    console.log('✅ Botul WhatsApp este gata!');
    console.log(`📌 Botul va trimite zilnic imaginea în grupul cu ID: ${process.env.WHATSAPP_GROUP_ID}`);

    schedule.scheduleJob('0 8 * * *', async function () {
        try {
            const folderIdSursa = process.env.FOLDER_ID_SURSA;
            const folderIdTrimise = process.env.FOLDER_ID_TRIMISE;

            console.log('📥 Caut prima imagine din folderul sursă...');
            const firstFile = await getFirstImageFromFolder(folderIdSursa);

            console.log(`📂 Fișier găsit: ${firstFile.name}`);
            const localPath = 'imagine.jpg';
            await downloadImage(firstFile.id, localPath);

            const media = MessageMedia.fromFilePath(localPath);
            await client.sendMessage(process.env.WHATSAPP_GROUP_ID, media);
            console.log('✅ Imagine trimisă cu succes în grup!');

            await moveFileToFolder(firstFile.id, folderIdTrimise);

        } catch (err) {
            console.error('❌ Eroare la trimiterea imaginii:', err);
        }
    });
});

// ==== PORNIRE BOT ====
(async () => {
    await authorizeGoogleDrive();
    client.initialize();
})();