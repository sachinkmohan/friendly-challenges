export type Os = 'android' | 'ios' | 'other'

export type Browser = { inApp: boolean; os: Os }

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

export function readBrowser(userAgent: string | undefined): Browser {
  const agent = userAgent ?? ''
  const os: Os = /\bAndroid\b/.test(agent) ? 'android' : /\b(iPhone|iPad|iPod)\b/.test(agent) ? 'ios' : 'other'
  return { inApp: inAppMarkers.some((marker) => marker.test(agent)), os }
}
