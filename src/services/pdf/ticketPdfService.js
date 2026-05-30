function buildTicketPdfPayload(booking) {
  return {
    fileName: `${booking.bookingRef}.pdf`,
    title: 'Classic Trip Ticket',
    bookingRef: booking.bookingRef,
    qrCodeValue: booking.qrCodeValue,
    note: 'PDFKit generation is wired as a service placeholder; production uploads generated PDFs to Cloudinary.',
  };
}

module.exports = { buildTicketPdfPayload };
