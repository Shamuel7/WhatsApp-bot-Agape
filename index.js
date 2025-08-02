const { Client, MessageMedia, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { google } = require('googleapis');
const schedule = require('node-schedule');
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');

// ==== CONECTARE MONGODB (pentru sesiunea WhatsApp) ====
mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log('✅ Conectat la MongoDB pentru sesiune WhatsApp');
});

const store = new MongoStore({ mongoose });

// ==== CONFIGURARE GOOGLE DRIVE ====
const credentials = require('./credentials.json');
const { client_secret, client_id, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const TOKEN_PATH = 'token.json';
const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// Autorizare Google Drive
async function authorizeGoogleDrive() {
    if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return;
    }
    console.error("❌ Token Google Drive lipsă! Creează-l local înainte de deploy pe Railway.");
    process.exit(1);
}

// Ia prima imagine din folderul sursă
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

// Descarcă imaginea
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

// Mută fișierul în alt folder
async function moveFileToFolder(fileId, targetFolderId) {
    const file = await drive.files.get({ fileId, fields: 'parents' });
    const previousParents = file.data.parents.join(',');
    await drive.files.update({
        fileId: fileId,
        addParents: targetFolderId,
        removeParents: previousParents,
        fields: 'id, parents'
    });
    console.log(`📦 Fișier mutat în folderul cu ID: ${targetFolderId}`);
}

// ==== CONFIGURARE WHATSAPP ====
const client = new Client({
    authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000 // 5 minute
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
    console.log(`📌 Botul va trimite zilnic imaginea în grupul bisericii.`);

    // Programare zilnică la ora 08:00
    schedule.scheduleJob('0 8 * * *', async function () {
        try {
            const folderIdSursa = '1i6p9xsYt13YMSKooiMhF-ghhfrBtmxF5';
            const folderIdTrimise = '1C9tl6ayzu5u-vWK8vp6i_-9x2nDwgnsn';
            const chatId = '120363338301113698@g.us'; // Grup biserică

            console.log('📥 Caut prima imagine din folderul sursă...');
            const firstFile = await getFirstImageFromFolder(folderIdSursa);

            console.log(`📂 Fișier găsit: ${firstFile.name}`);
            const localPath = 'imagine.jpg';
            await downloadImage(firstFile.id, localPath);

            const media = MessageMedia.fromFilePath(localPath);
            await client.sendMessage(chatId, media);
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