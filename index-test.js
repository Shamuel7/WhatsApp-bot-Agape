const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

// ==== CONFIGURARE GOOGLE DRIVE ====
const credentials = require('./credentials.json');
const { client_secret, client_id, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const TOKEN_PATH = 'token.json';

// Numele grupului de test
const groupName = 'Grup Test'; // <-- schimbă aici numele grupului de test

// Funcție pentru salvarea token-ului
function storeToken(token) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
    console.log('✅ Token salvat în', TOKEN_PATH);
}

// Autorizare Google Drive
async function authorizeGoogleDrive() {
    if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return;
    }

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive'] // Permisiuni COMPLETE
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

// Ia prima imagine din folder
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

// Descarcă imagine
async function downloadImage(fileId, destPath) {
    const dest = fs.createWriteStream(destPath);
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
        res.data.on('end', resolve).on('error', reject).pipe(dest);
    });
}

// Mută fișier în alt folder
async function moveFileToFolder(fileId, targetFolderId) {
    const file = await drive.files.get({ fileId: fileId, fields: 'parents' });
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
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('📱 Scanează acest cod QR cu WhatsApp!');
});

client.on('ready', async () => {
    console.log('✅ Botul WhatsApp (TEST) este gata!');
    console.log(`📌 Caut grupul cu numele: "${groupName}"\n`);

    const chats = await client.getChats();
    const group = chats.find(chat => chat.isGroup && chat.name === groupName);

    if (!group) {
        console.error(`❌ Grupul "${groupName}" nu a fost găsit! Asigură-te că botul este membru în grup.`);
        return;
    }

    const chatId = group.id._serialized;
    console.log(`✅ Grup găsit: ${groupName} | ID: ${chatId}`);

    try {
        const folderIdSursa = '1i6p9xsYt13YMSKooiMhF-ghhfrBtmxF5'; // Folder sursă
        const folderIdTrimise = '1C9tl6ayzu5u-vWK8vp6i_-9x2nDwgnsn'; // Folder Trimise
        console.log('📥 Caut prima imagine din folderul sursă...');
        const firstFile = await getFirstImageFromFolder(folderIdSursa);

        console.log(`📂 Fișier găsit: ${firstFile.name}`);
        const localPath = 'imagine.jpg';
        await downloadImage(firstFile.id, localPath);

        const media = MessageMedia.fromFilePath(localPath);
        await client.sendMessage(chatId, media);
        console.log('✅ Imagine trimisă cu succes în grupul de test!');

        await moveFileToFolder(firstFile.id, folderIdTrimise);
    } catch (err) {
        console.error('❌ Eroare la test:', err);
    }
});

// Inițiere
(async () => {
    await authorizeGoogleDrive();
    client.initialize();
})();