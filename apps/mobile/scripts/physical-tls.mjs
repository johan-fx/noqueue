// Development-only certificate generation; never installs trust automatically.
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { privateHost } from '../../api/scripts/mobile-network.mjs'
const host = process.env.NOQUEUE_LOCAL_HOST
if (!privateHost(host ?? '')) throw new Error('Set NOQUEUE_LOCAL_HOST to the private IPv4 address of this Mac')
const dir = fileURLToPath(new URL('../../../reports/ios-device/tls/', import.meta.url))
mkdirSync(dir, { recursive: true, mode: 0o700 })
process.umask(0o077)
const openssl = args => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
// Never silently replace a trusted CA or rotate existing keys.
if (!existsSync(path.join(dir, 'ca.key'))) {
  openssl(['req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','7','-subj','/CN=NoQueue local development',
    '-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign',
    '-keyout','ca.key','-out','ca.pem'])
}
openssl(['x509','-checkend','3600','-noout','-in','ca.pem'])
if (!existsSync(path.join(dir, 'server.key'))) {
  openssl(['req','-new','-newkey','rsa:2048','-nodes','-sha256','-subj',`/CN=${host}`,'-keyout','server.key','-out','server.csr'])
  writeFileSync(path.join(dir,'server.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${host},IP:127.0.0.1,DNS:localhost\n`)
  openssl(['x509','-req','-in','server.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-days','7','-sha256','-extfile','server.ext','-out','server.pem'])
}
openssl(['x509','-checkend','3600','-noout','-in','server.pem'])
openssl(['verify','-CAfile','ca.pem','-verify_ip',host,'server.pem'])
openssl(['x509','-in','ca.pem','-outform','DER','-out','noqueue-local.cer'])
console.log(`Local certificates ready: ${dir}`)
console.log(openssl(['x509','-in','ca.pem','-noout','-fingerprint','-sha256','-dates']).toString().trim())
