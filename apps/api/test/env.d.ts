declare namespace Cloudflare {
  interface Env extends CloudflareBindings {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}
