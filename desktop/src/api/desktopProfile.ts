import { api } from './client'
import type {
  DesktopProfileBundle,
  DesktopProfileBundlePatch,
} from '../types/desktopProfile'

const ENDPOINT = '/api/settings/desktop-profile'

export const desktopProfileApi = {
  get() {
    return api.get<DesktopProfileBundle>(ENDPOINT)
  },

  patch(patch: DesktopProfileBundlePatch) {
    return api.patch<DesktopProfileBundle>(ENDPOINT, patch)
  },

  reset() {
    return api.delete<{ ok: true }>(ENDPOINT)
  },
}
