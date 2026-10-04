import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

export function getServerPaths(moduleUrl: string) {
  // Both src/index.ts and dist/index.js live one directory below the server root.
  const serverRoot = path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..')
  return { serverRoot, appRoot: path.resolve(serverRoot, '..') }
}

export function loadServerEnvironment(moduleUrl: string, processEnv = process.env) {
  const paths = getServerPaths(moduleUrl)
  const files = [path.join(paths.serverRoot, '.env'), path.join(paths.appRoot, '.env')]
    .filter(file => existsSync(file))
  // Deployed environment variables win; server/.env precedes the legacy app/.env.
  if (files.length) dotenv.config({ path: files, processEnv })
  return paths
}

export function resolveConfigFile(file: string, paths: ReturnType<typeof getServerPaths>) {
  if (path.isAbsolute(file)) return path.resolve(file)
  const serverFile = path.resolve(paths.serverRoot, file)
  if (existsSync(serverFile)) return serverFile
  const legacyFile = path.resolve(paths.appRoot, file)
  return existsSync(legacyFile) ? legacyFile : serverFile
}
