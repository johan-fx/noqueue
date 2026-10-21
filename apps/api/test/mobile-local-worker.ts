// Only the local emulator harness references this entrypoint. Never deploy it.
import './http-only-platform'
import { setupNetwork } from './fake-network'
import { http, HttpResponse } from 'msw'
setupNetwork().use(http.all('*', () => HttpResponse.error()))
export { default, QueueCoordinator } from '../src/index'
