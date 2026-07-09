/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require("pdfmake");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TDocumentDefinitions = any;

// Load fonts from pdfmake vfs
const vfs = require('pdfmake/build/vfs_fonts');

export const printer = new PdfPrinter({
  Roboto: {
    normal: Buffer.from(vfs['Roboto-Regular.ttf'], 'base64'),
    bold: Buffer.from(vfs['Roboto-Medium.ttf'], 'base64'),
    italics: Buffer.from(vfs['Roboto-Italic.ttf'], 'base64'),
    bolditalics: Buffer.from(vfs['Roboto-MediumItalic.ttf'], 'base64'),
  }
});

export function buildPdf(docDef: TDocumentDefinitions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = printer.createPdfKitDocument(docDef);
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// Pacific Granites (India) Pvt. Ltd. — used for Granite PGI documents
export const GRANITE_COMPANY_DEFAULTS = {
  name:        'Pacific Granites (India) Pvt. Ltd.',
  address:     'Konerupalli Union, Shoolagiri Block, Krishnagiri Dist.\nHosur, Tamilnadu 635117',
  phone:       '434-429-4054 / 984-516-4342',
  website:     'www.pacificgranitesindia.com',
  iec:         '3811000012',
  gstin:       '33AAFCP5374A1ZQ',
  bankName:    'Kotak Mahindra Bank Limited',
  bankAddr:    '10/7, Umiya Landmark, Lavelle Road, Next to Chancery Hotel, Bangalore 560001, Karnataka, India',
  accountNo:   '8711541164',
  swift:       'KKBKINBBXXX',
  adCode:      '0180038 8400009',
  routingBank: 'The Bank of New York Mellon, No.1, Wall St. New York, NY 10015',
  routingSwift:'IRVTUS3NXXX',
  portOfLoading:'CHENNAI PORT',
  hsnCode:     '25161200',
  jurisdiction:'OFFICE OF THE ASSISTANT COMMISSIONER OF CUSTOMS CUSTOMS PREVENTIVE UNIT, ROOM NO.32 & 33, PHASE2, 3rd FLOOR, NO.6/7, A.T.D. STREET, RACE COURSE ROAD, COIMBATORE-641018.',
};

export const COMPANY_DEFAULTS = {
  name:       'Pacific Engineered Surfaces Private Limited',
  address:    'SY.NO.73/2B, NALLAGANAKOTAPALLI VILLAGE, N.H.7,\nHOSUR, Krishnagiri, Hosur - 635 117\nTamilnadu, India',
  iec:        'AALCP2750N',
  gstin:      '33AALCP2750N1Z3',
  pan:        'AALCP2750N',
  stateCode:  '33',
  distCode:   '577',
  bankName:   'Kotak Mahindra Bank Limited',
  bankAddr:   '10/7, Umiya Landmark, Lavelle Road, Next to Chancery Hotel, Bangalore 560001, Karnataka, India',
  accountNo:  '3214292773',
  swift:      'KKBKINBBXXX',
  adCode:     '0180038-8400009',
  routingBank:'The Bank of New York Mellon, No.1, Wall St. New York, NY 10015',
  routingSwift:'IRVTUS3NXXX',
  portOfLoading: 'ENNORE PORT, INDIA',
  placeOfReceipt:'ENNORE PORT, INDIA',
  hsnCode:    '68101990',
  jurisdictionOffice: 'OFFICE OF THE ASSISTANT COMMISSIONER OF CUSTOMS, CUSTOMS PREVENTIVE UNIT, 21B, RAAGAVIS CENTER, I-FLOOR, NETHAJI NAGAR, NANJUNDAPURAM MAIN ROAD, RAMANATHAPURAM, COIMBATORE-641045.',
};

export function companyHeader(config: any) {
  const name = config?.companyName || COMPANY_DEFAULTS.name;
  const addr = config?.companyAddress || COMPANY_DEFAULTS.address;
  const iec  = config?.iecCode || COMPANY_DEFAULTS.iec;
  const gst  = config?.gstNo   || COMPANY_DEFAULTS.gstin;
  return [
    { text: name, style: 'companyName' },
    { text: addr, style: 'companyAddr' },
    { text: `IEC Code: ${iec}  |  GSTIN: ${gst}`, style: 'companyAddr' },
  ];
}

export const docStyles = {
  companyName: { fontSize: 13, bold: true, marginBottom: 2 },
  companyAddr: { fontSize: 8, color: '#555', marginBottom: 1 },
  sectionLabel: { fontSize: 8, bold: true, color: '#333', marginTop: 6, marginBottom: 2 },
  tableHeader: { fontSize: 8, bold: true, fillColor: '#f0f0f0' },
  tableCell: { fontSize: 8 },
  h1: { fontSize: 14, bold: true, marginBottom: 4 },
};

export function amountToWords(amount: number, currency = 'USD'): string {
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  function toWords(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ones[n] + ' ';
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '') + ' ';
    if (n < 1000) return ones[Math.floor(n/100)] + ' HUNDRED ' + toWords(n%100);
    if (n < 100000) return toWords(Math.floor(n/1000)) + 'THOUSAND ' + toWords(n%1000);
    if (n < 10000000) return toWords(Math.floor(n/100000)) + 'LAKH ' + toWords(n%100000);
    return toWords(Math.floor(n/10000000)) + 'CRORE ' + toWords(n%10000000);
  }
  const int = Math.floor(amount);
  const dec = Math.round((amount - int) * 100);
  let words = `${currency} ${toWords(int).trim()}`;
  if (dec > 0) words += ` AND CENTS ${toWords(dec).trim()}`;
  return words + ' ONLY';
}
