const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

// ==== CONFIGURARE GOOGLE DRIVE ====
const credentials = require('./credentials.json');
const { client_secret, client_id, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const TOKEN_PATH = 'token.json';

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
        scope: ['https://www.googleapis.com/auth/drive'] // 🔹 Permisiuni COMPLETE
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
    if (!res.data.files.length) throw new Error('⚠️ Folderul nu conține imagini!');
    return res.data.files[0];
}

// Mută un fișier în alt folder
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

// === RULEAZĂ TESTUL ===
(async () => {
    await authorizeGoogleDrive();

    const folderIdSursa = '1i6p9xsYt13YMSKooiMhF-ghhfrBtmxF5'; // Folder sursă
    const folderIdTrimise = '1C9tl6ayzu5u-vWK8vp6i_-9x2nDwgnsn'; // Folder Trimise

    try {
        console.log('📥 Caut prima imagine din folderul sursă...');
        const firstFile = await getFirstImageFromFolder(folderIdSursa);
        console.log(`📂 Fișier găsit: ${firstFile.name}`);

        await moveFileToFolder(firstFile.id, folderIdTrimise);
        console.log('✅ Mutare finalizată cu succes!');
    } catch (err) {
        console.error('❌ Eroare:', err);
    }
})();