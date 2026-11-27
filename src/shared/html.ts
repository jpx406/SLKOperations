/** Text made safe to put in HTML, attributes included: & < > " ' are escaped. Used by the printed pages, the e-mails
 *  and the exports (6z.72); every page used to carry its own copy, some of which missed > and quotes. */
export const escHtml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
