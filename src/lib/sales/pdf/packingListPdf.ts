/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { buildPdf, docStyles, COMPANY_DEFAULTS } from "./common";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TDocumentDefinitions = any;

export async function generatePackingListPdf(orderId: string): Promise<Buffer> {
  const db = prisma as any;
  const [order, config] = await Promise.all([
    db.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        client: true,
        sp: { select: { name: true, email: true } },
        shipmentDocs: true,
        proformaInvoices: { where: { status: 'ACCEPTED' }, take: 1, orderBy: { acceptedAt: 'desc' } },
      },
    }),
    db.salesConfig.findUnique({ where: { id: 'global' } }).catch(() => null),
  ]);
  if (!order) throw new Error('Order not found');

  const pi   = order.proformaInvoices?.[0];
  const ship = order.shipmentDocs;
  // Merge per-item net weights entered by commercial
  const rawItems: any[] = pi && Array.isArray(pi.items) ? pi.items : [];
  const packingOverrides: { index: number; netWeight: number | null }[] =
    Array.isArray(ship?.packingItems) ? (ship.packingItems as any[]) : [];
  const items: any[] = rawItems.map((item, idx) => {
    const override = packingOverrides.find(o => o.index === idx);
    return override ? { ...item, netWeight: override.netWeight } : item;
  });

  const C = {
    name:    config?.companyName    || COMPANY_DEFAULTS.name,
    address: config?.companyAddress || COMPANY_DEFAULTS.address,
    iec:     config?.iecCode        || COMPANY_DEFAULTS.iec,
    gstin:   config?.gstNo          || COMPANY_DEFAULTS.gstin,
  };

  const invoiceNo   = order.invoiceNumber || order.orderNumber;
  const invoiceDate = ship?.blDate
    ? new Date(ship.blDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const pol = pi?.portOfLoading   || ship?.portOfLoading   || COMPANY_DEFAULTS.portOfLoading;
  const pod = pi?.portOfDischarge || ship?.portOfDischarge || '';

  const totalSlabs = items.reduce((s: number, r: any) => s + (r.noOfSlabs ?? 0), 0);
  const totalSqft  = items.reduce((s: number, r: any) => s + Number(r.sqft ?? r.sqFt ?? 0), 0);

  const itemRows = items.map((item: any) => [
    { text: item.colour || item.description || item.desc || '', style: 'tableCell' },
    { text: item.thickness || '', style: 'tableCell', alignment: 'center' },
    { text: item.netWeight != null ? String(item.netWeight) : '', style: 'tableCell', alignment: 'right' },
    { text: item.noOfSlabs != null ? String(item.noOfSlabs) : '', style: 'tableCell', alignment: 'center' },
    { text: Number(item.sqft ?? item.sqFt ?? 0).toFixed(3), style: 'tableCell', alignment: 'right' },
    { text: 'SQFT', style: 'tableCell', alignment: 'center' },
    { text: item.remarks || '', style: 'tableCell' },
  ]);

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: 'Roboto', fontSize: 8.5 },
    styles: {
      ...docStyles as any,
      heading: { fontSize: 22, bold: true, alignment: 'center' },
      subheading: { fontSize: 9, alignment: 'center', color: '#555' },
      label: { fontSize: 7.5, bold: true, color: '#333' },
      small: { fontSize: 7.5, color: '#555' },
      tableHeader: { fontSize: 7.5, bold: true, fillColor: '#f5f5f5' },
      tableCell: { fontSize: 7.5 },
    },
    content: [
      { text: 'Sree Hari Om', italics: true, alignment: 'center', fontSize: 9, marginBottom: 2 },
      { text: 'Packing List', style: 'heading', marginBottom: 2 },
      { text: '(Under Rule 46 CGST 2017)', alignment: 'center', fontSize: 9, color: '#555', marginBottom: 4 },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 0.5 }], marginBottom: 4 },
      {
        columns: [
          {
            width: '55%',
            stack: [
              { text: 'Exporter:', style: 'label' },
              { text: C.name, bold: true, fontSize: 11, marginBottom: 2 },
              { text: C.address, style: 'small' },
            ],
          },
          {
            width: '45%',
            stack: [
              {
                table: {
                  widths: ['45%', '55%'],
                  body: [
                    [{ text: 'Invoice No.', style: 'label', border:[false,false,false,false] }, { text: invoiceNo, bold: true, border:[false,false,false,false] }],
                    [{ text: 'Dated', style: 'label', border:[false,false,false,false] }, { text: invoiceDate, border:[false,false,false,false] }],
                    [{ text: "Buyer's PO Ref.", style: 'label', border:[false,false,false,false] }, { text: pi?.buyerPoNo || pi?.piNumber || '---', border:[false,false,false,false] }],
                    [{ text: 'IEC Code No.', style: 'label', border:[false,false,false,false] }, { text: `IEC ${C.iec}`, bold: true, border:[false,false,false,false] }],
                    [{ text: 'GSTIN No.', style: 'label', border:[false,false,false,false] }, { text: C.gstin, border:[false,false,false,false] }],
                  ],
                },
                layout: 'noBorders',
                fontSize: 8,
              },
            ],
          },
        ],
        marginBottom: 4,
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 0.5 }], marginBottom: 4 },
      {
        table: {
          widths: ['50%', '50%'],
          body: [
            [
              {
                stack: [
                  { text: 'Consignee:', style: 'label' },
                  { text: pi?.consigneeDetails || (order.client.name + '\n' + (order.client.address || '')), fontSize: 8, marginTop: 2 },
                ],
                border: [true, true, true, true], padding: [4,4,4,4],
              },
              {
                stack: [
                  { text: 'Notify Party:', style: 'label' },
                  { text: pi?.notifyPartyDetails || '---', fontSize: 8, marginTop: 2 },
                  { text: '', marginTop: 6 },
                  { text: 'Terms & Conditions:', style: 'label', marginTop: 4 },
                  { text: [{ text: 'Delivery Terms: ', bold: true }, (order.deliveryTerms || pi?.deliveryTerms || '---')], fontSize: 7.5 },
                  { text: [{ text: 'Payment Terms: ', bold: true }, (pi?.paymentTermsSummary || '---')], fontSize: 7.5 },
                ],
                border: [true, true, true, true], padding: [4,4,4,4],
              },
            ],
          ],
        },
        marginBottom: 4,
        fontSize: 8,
      },
      {
        table: {
          widths: ['34%', '34%', '32%'],
          body: [
            [
              { text: [{ text: 'Pre-Carriage By:\n', style: 'label' }, 'By Road'], border:[true,true,true,true], fontSize: 7.5, padding:[3,3,3,3] },
              { text: [{ text: 'Place of Receipt By Pre-Carrier:\n', style: 'label' }, pol], border:[true,true,true,true], fontSize: 7.5, padding:[3,3,3,3] },
              { text: [{ text: 'Vessel/Flight No.:\n', style: 'label' }, ship?.vesselName || '---'], border:[true,true,true,true], fontSize: 7.5, padding:[3,3,3,3] },
            ],
            [
              { text: [{ text: 'Port of Discharge:\n', style: 'label' }, pod], border:[true,true,true,true], fontSize: 7.5, padding:[3,3,3,3] },
              { text: [{ text: 'Port of Loading:\n', style: 'label' }, pol], border:[true,true,true,true], fontSize: 7.5, padding:[3,3,3,3] },
              { text: [{ text: 'Final Destination:\n', style: 'label' }, pi?.finalDestination || pod], border:[true,true,true,true], fontSize: 7.5, padding:[3,3,3,3] },
            ],
          ],
        },
        marginBottom: 4,
      },
      {
        stack: [
          { text: `Marks & Nos: ${ship?.containerNo || '---'}     HSN No: ${COMPANY_DEFAULTS.hsnCode}`, fontSize: 7.5 },
          { text: 'Artificial Quartz Slabs', bold: true, fontSize: 7.5, marginBottom: 2 },
        ],
      },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', '*'],
          body: [
            [
              { text: 'Colour', style: 'tableHeader' },
              { text: 'Thick', style: 'tableHeader', alignment: 'center' },
              { text: 'Net Wt', style: 'tableHeader', alignment: 'right' },
              { text: 'No.of\nSlabs/Pcs', style: 'tableHeader', alignment: 'center' },
              { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
              { text: 'Unit', style: 'tableHeader', alignment: 'center' },
              { text: 'Remarks', style: 'tableHeader' },
            ],
            ...itemRows,
            [
              { text: 'Total -- Slabs / Pcs', bold: true, fontSize: 7.5, colSpan: 3 }, {}, {},
              { text: String(totalSlabs), bold: true, fontSize: 7.5, alignment: 'center' },
              { text: totalSqft.toFixed(3), bold: true, fontSize: 7.5, alignment: 'right' },
              { text: 'SQFT', fontSize: 7.5, alignment: 'center' },
              { text: '', fontSize: 7.5 },
            ],
          ],
        },
        layout: 'lightHorizontalLines',
        marginBottom: 6,
      },
      {
        stack: [
          { text: `Container No. ${ship?.containerNo || '---'}`, bold: true, fontSize: 8 },
          { text: `Liner OTL No. ${(ship as any)?.linerOtlNo || '---'}`, fontSize: 7.5 },
          { text: `E-Seal No. ${(ship as any)?.eSealNo || '---'}`, fontSize: 7.5 },
          { text: `Vehicle No. ${(ship as any)?.vehicleNo || '---'}`, fontSize: 7.5 },
          { text: `BL No. ${ship?.blNo || ''}`, fontSize: 7.5 },
          { text: `SB No. ${ship?.sbNo || ''}`, fontSize: 7.5 },
        ],
        marginBottom: 4,
      },
      {
        stack: [
          { text: 'Summary', style: 'label', marginBottom: 2 },
          { text: `Tot. Area in Sq.ft:  ${totalSqft.toFixed(3)}`, fontSize: 7.5 },
          { text: `Tot. No. of Pcs:  ${totalSlabs}`, fontSize: 7.5 },
          { text: `Tot. No. of Packages:  ${(ship as any)?.packageDescription || '---'}`, fontSize: 7.5 },
        ],
        marginBottom: 6,
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 0.5 }], marginBottom: 3 },
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Weight in MT', style: 'label' },
              { text: `Gross Wt: ${(ship as any)?.grossWeight || ''} MT`, fontSize: 7.5 },
              { text: `Net Wt:   ${(ship as any)?.netWeight   || ''} MT`, fontSize: 7.5 },
              { text: '\nDeclaration:', style: 'label' },
              { text: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', fontSize: 7, italics: true },
            ],
          },
          {
            width: '50%',
            alignment: 'right',
            stack: [
              { text: `For ${C.name}`, bold: true, fontSize: 8 },
              { text: '\n\n\n', fontSize: 8 },
              { text: '(Authorised Signatory)', fontSize: 8 },
            ],
          },
        ],
      },
    ],
  };

  return buildPdf(docDef);
}
