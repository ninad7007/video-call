export interface PushRow {
  id: string
  endpoint?: string | null
  p256dh?: string | null
  auth_key?: string | null
  voip_token?: string | null
  token_type?: string | null
  platform?: string | null
  apns_env?: 'sandbox' | 'production' | null
}

export function groupSubscriptions(rows: PushRow[]) {
  const voipSubs = rows.filter((s) => s.token_type === 'apns_voip' && !!s.voip_token)
  const webSubs = rows.filter((s) => !!s.endpoint && !s.voip_token)
  return { webSubs, voipSubs }
}
