import path from 'node:path'

export function verificationEnvironment(parent, directory, { all, extended }) {
  return {
    ...parent,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    QUEUE_REPORT_DIR: directory,
    QUEUE_PROPERTY_RUNS: extended ? '2000' : '200',
    QUEUE_SEQUENCE_RUNS: extended ? '100' : '20',
    QUEUE_SEQUENCE_LENGTH: extended ? '100' : '25',
    // The full profile must execute opt-in cycle and visual tests, not skip them.
    // These variables only configure the isolated E2E Worker and its artifacts.
    NOQUEUE_E2E_AUTO_REPLACEMENT: all ? 'true' : 'false',
    REPLACEMENT_SCREENSHOTS: all ? path.join(directory, 'cycle-screenshots') : '',
  }
}
