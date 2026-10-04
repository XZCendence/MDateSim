/**
 * Build an sms: URL that opens Messages with the line and a prefilled body.
 *
 * iOS reads `&body=`; Android reads a query string (`?body=`). `sms:<num>&body=`
 * therefore opens the thread on Android with an empty compose box. This QR is
 * scanned by either phone, so one URL has to satisfy both:
 * `sms://<num>;?&body=` — the `;` ends the iOS recipient list, `?` starts the
 * Android query, and `&body=` is what iOS looks for.
 */
export function smsLink(number: string, body: string): string {
  return `sms://${number};?&body=${encodeURIComponent(body)}`;
}
