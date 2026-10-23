import { pathToFileURL } from 'node:url'
export const requiredJobs = ['checks', 'build', 'api', 'browser', 'production-browser', 'android']
export function requireSuccessfulJobs(jobs) {
  if (Object.keys(jobs).length !== requiredJobs.length ||
      requiredJobs.some((name) => jobs[name]?.result !== 'success'))
    throw new Error('Every CI job is required; failure, cancellation, missing or skipped jobs block integration')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  requireSuccessfulJobs(JSON.parse(process.env.JOB_RESULTS ?? '{}'))
