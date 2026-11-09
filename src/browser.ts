export type Os = 'android' | 'ios' | 'other'

// Which Add to Home Screen steps an iPhone browser gets. Only Safari, Chrome and Edge can add a web app there.
export type IosInstall = 'safari' | 'chrome' | 'edge' | 'use_safari'

export type Browser = { inApp: boolean; os: Os; iosInstall: IosInstall | null }

const inAppMarkers: readonly RegExp[] = [
  /\bFBAN\/|\bFBAV\/|\bFB_IAB\/|\bFBIOS\b/,
  /\bInstagram\b/,
  /\bWhatsApp\b/,
  /\bLinkedInApp\b/,
  /\bTwitter\b/,
  /\bTelegram\b/,
  /\bmusical_ly\b|\bBytedanceWebview\b|\bTikTok\b/,
  /\bSnapchat\b/,
  /\bLine\//,
  /; wv\)/,
  /\b(iPhone|iPad|iPod)\b(?!.*\bSafari\/)/,
]

// Other iPhone browsers keep the Safari token, so Safari is the one with Version/ and none of these.
const otherIosBrowsers = /\b(FxiOS|OPT|OPiOS|GSA|YaBrowser|DuckDuckGo|Focus|Brave)\//

function iosInstallFor(agent: string, inApp: boolean): IosInstall {
  if (inApp) return 'use_safari'
  if (/\bCriOS\//.test(agent)) return 'chrome'
  if (/\bEdgiOS\//.test(agent)) return 'edge'
  if (/\bVersion\/[\d.]+\b/.test(agent) && !otherIosBrowsers.test(agent)) return 'safari'
  return 'use_safari'
}

export function readBrowser(userAgent: string | undefined): Browser {
  const agent = userAgent ?? ''
  const os: Os = /\bAndroid\b/.test(agent) ? 'android' : /\b(iPhone|iPad|iPod)\b/.test(agent) ? 'ios' : 'other'
  const inApp = inAppMarkers.some((marker) => marker.test(agent))
  return { inApp, os, iosInstall: os === 'ios' ? iosInstallFor(agent, inApp) : null }
}
