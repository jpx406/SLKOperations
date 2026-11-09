// Date and time for the Prepared / Reviewed boxes on the PDF. Change the time zone and label for your region.
export const stampText = (iso: string) =>
  `${new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} Riyadh`;
