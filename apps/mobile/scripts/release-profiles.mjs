// Public build configuration only. These profiles never authorize backend sends.
export function mobileProfile(profile) {
  if (!['internal-staging', 'production'].includes(profile))
    throw new Error('Expected --profile internal-staging or production')
  const production = profile === 'production'
  return Object.freeze({ profile, environment: production ? 'production' : 'staging',
    origin: production ? 'https://app.noqueue-app.com' : 'https://staging.noqueue-app.com' })
}
