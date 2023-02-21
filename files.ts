import os from 'os';
import path from 'path';
import { constants, promises as fs } from 'fs';
// import Hash from 'ipfs-only-hash';
import type { PeerId } from '@libp2p/interface-peer-id';
import type { RsaPrivateKey } from '@libp2p/crypto/keys/rsa-class';
import type { PublicKey } from '@libp2p/interface-keys';
import type { Logger } from '@libp2p/logger';

let log: Logger;
let myPeerId: PeerId;
let privateKey: RsaPrivateKey;
// let cipher: any;

interface ItemJson {
  item: string,
  byPubkey: string,
  byPeerId: string,
  cidPrev: string,
  sig:string,
}

function getDir() {
  return path.join(os.homedir(), `.i2KnV3-${myPeerId}`);
}

async function createCIDfromJson(item: any): Promise<string> {
  const { CID } = await import('multiformats/cid');
  const json = await import('multiformats/codecs/json');
  const { sha256 } = await import('multiformats/hashes/sha2');

  const bytes = json.encode({
    id: item.id,
    name: item.name,
    content: item.content,
  });
  const hash = await sha256.digest(bytes);
  const cid = CID.create(1, json.code, hash);
  return cid.toString();
}

async function createRepo() {
  if (!myPeerId) throw new Error('Files API must be initialized first');

  const dir = getDir();
  try {
    await fs.access(dir, constants.R_OK || constants.W_OK);
  } catch {
    await fs.mkdir(dir);
    await fs.writeFile(`${dir}/I2Kn_companies.db`, '[]');
    await fs.writeFile(`${dir}/I2Kn_bases.db`, '[]');
    await fs.writeFile(`${dir}/I2Kn_pages.db`, '[]');
    await fs.writeFile(`${dir}/I2Kn_users.db`, '[]');
  }
}

// PeerId DOC : https://github.com/libp2p/specs/blob/master/peer-ids/peer-ids.md
async function init(privKey: string) {
  const { createFromPrivKey } = await import('@libp2p/peer-id-factory');
  const { unmarshalPrivateKey } = await import('@libp2p/crypto/keys');
  const uint8ArrayFromString = (await import('uint8arrays/from-string')).fromString;

  const { logger } = await import('@libp2p/logger');

  log = logger('i2kn:api:files');

  // const peerId = await createRSAPeerId();

  const privKeyBuffer = uint8ArrayFromString(privKey, 'base64pad');
  privateKey = await unmarshalPrivateKey(privKeyBuffer) as RsaPrivateKey;
  myPeerId = await createFromPrivKey(privateKey);

  log('init files repo :', myPeerId.toString());
}

async function save(itemstring:string, cidPrev?: string): Promise<string> {
  const uint8ArrayToString = (await import('uint8arrays/to-string')).toString;
  const uint8ArrayFromString = (await import('uint8arrays/from-string')).fromString;
  const crypto = await import('@libp2p/crypto');
  if (!myPeerId) throw new Error('Files API must be initialized first');

  // CID
  const item = JSON.parse(itemstring);
  const cid = await createCIDfromJson(item);
  // const cid: string = await Hash.of(`${item.id}+${item.name}+${item.content}`);
  item.cid = cid.toString();
  itemstring = JSON.stringify(item);

  // encrypt AES
  const cipher = await crypto.aes.create(
    privateKey.bytes.slice(0, 32), // 32 bytes : SHA-256
    privateKey.bytes.slice(32, 48), // 16 bytes
  );
  const cryptaes = uint8ArrayToString(await cipher.encrypt(uint8ArrayFromString(itemstring)), 'base64pad');
  log('cryptage AES:', cryptaes);

  // encrypt RSA
  // const encrsa = await privateKey.public.encrypt(uint8ArrayFromString(itemstring));
  // log('cryptage RSA:', encrsa);
  // const dec = await privateKey.decrypt(encrsa);
  // const decs = uint8ArrayToString(dec);
  // log('decryptage RSA:', decs);

  // sign
  const sig = uint8ArrayToString(await privateKey.sign(uint8ArrayFromString(itemstring)), 'base64pad');

  await fs.writeFile(`${getDir()}/${cid}`, JSON.stringify({
    item: cryptaes,
    byPubkey: uint8ArrayToString(privateKey.public.bytes, 'base64pad'),
    // byPeerId: myPeerId.toString(), // = await privateKey.id()
    cidPrev,
    sig,
  }));

  return cid;
}

async function load(cid:string): Promise<string> {
  if (!myPeerId) throw new Error('Files API must be initialized first');

  const { createFromPubKey } = await import('@libp2p/peer-id-factory');
  const { unmarshalPublicKey } = await import('@libp2p/crypto/keys');
  const uint8ArrayFromString = (await import('uint8arrays/from-string')).fromString;
  const uint8ArrayToString = (await import('uint8arrays/to-string')).toString;
  const crypto = await import('@libp2p/crypto');

  const content = await fs.readFile(`${getDir()}/${cid}`, 'utf-8');

  const itemJson: ItemJson = JSON.parse(content);

  // compute peerId from publickey
  const fromPubkey: PublicKey = unmarshalPublicKey(uint8ArrayFromString(itemJson.byPubkey, 'base64pad'));
  const fromPeerId = await createFromPubKey(fromPubkey);
  // log('fromPeerId:', fromPeerId.toString());
  // if (itemJson.byPeerId !== fromPeerId.toString()) return 'BAD PEERID';

  // decrypt AES
  // TODO-ont decrypt RSA
  const cipher = await crypto.aes.create(
    privateKey.bytes.slice(0, 32), // 32 bytes : SHA-256
    privateKey.bytes.slice(32, 48), // 16 bytes
  );
  const decryptaes = uint8ArrayToString(await cipher.decrypt(uint8ArrayFromString(itemJson.item, 'base64pad')));
  log('decryptage AES:', decryptaes);

  // verify signature
  const sigOK = await fromPubkey.verify(
    uint8ArrayFromString(decryptaes),
    uint8ArrayFromString(itemJson.sig, 'base64pad'),
  );

  // verify CID
  const jitem = JSON.parse(decryptaes);
  const verifyCid = await createCIDfromJson(jitem);
  // const verifyCid: string = await Hash.of(`${jitem.id}+${jitem.name}+${jitem.content}`);
  // const verifyCid: string = await Hash.of(decryptaes);
  log('verifyCid:', verifyCid);

  const item = {
    item: decryptaes,
    cidPrev: itemJson.cidPrev,
    byPeerId: fromPeerId.toString(),
    sigOK,
    cidOK: verifyCid === cid,
  };

  return JSON.stringify(item);
}

async function saveClear(title:string, content: string) {
  await fs.writeFile(`${getDir()}/${title}`, content, 'utf-8');
}

async function loadClear(title:string): Promise<string> {
  const content: string = await fs.readFile(`${getDir()}/${title}`, 'utf-8');
  return content;
}

async function eraseDir() {
  await fs.rmdir(getDir());
}

function print(url:string) {
  // Defining a new BrowserWindow Instance
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
    },
  });
  win.loadURL(url);

  const options = {
    silent: false,
    printBackground: true,
    color: false,
    margin: {
      marginType: 'printableArea',
    },
    landscape: false,
    pagesPerSheet: 1,
    collate: false,
    copies: 1,
    header: 'Header of the Page',
    footer: 'Footer of the Page',
  };

  win.webContents.on('did-finish-load', () => {
    win.webContents.print(options, (success, failureReason) => {
      if (!success) log(failureReason);
      log('Print Initiated');
      win.destroy();
    });
  });
}

const files = {
  init,
  createRepo,
  save,
  load,
  saveClear, // save a file without encryption
  loadClear, // load a file without encryption
  eraseDir,
  print,
};

export default files;
