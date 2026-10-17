import { assertProductionConfig, readConfig } from './config.mjs'
if (process.argv.slice(2).some((arg) => arg !== '--provisioned')) throw new Error('Only --provisioned is supported')
assertProductionConfig(await readConfig(), { provisioned: process.argv.includes('--provisioned') })
console.log(process.argv.includes('--provisioned') ? 'Production configuration identity verified (not remote existence/readiness).' : 'Production configuration checked; resource IDs, secrets and provider approvals remain pending.')
