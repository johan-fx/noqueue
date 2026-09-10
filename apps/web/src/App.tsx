import { RouterProvider } from 'react-router'
import { createAppRouter } from '@/app/bootstrap/create-app-router'
import { detectRuntime } from '@/app/bootstrap/runtime'

const router = createAppRouter(detectRuntime())

export default function App() {
  return <RouterProvider router={router} />
}
