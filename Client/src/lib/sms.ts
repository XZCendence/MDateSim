/** Build an sms: URL that opens Messages with the line and a prefilled body. */
export function smsLink(number: string, body: string): string {
  // iOS accepts `sms:<num>&body=`, Android `sms:<num>?body=`; `&` works on both in practice.
  return `sms:${number}&body=${encodeURIComponent(body)}`;
}
