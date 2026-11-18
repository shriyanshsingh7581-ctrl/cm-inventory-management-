import { jsPDF } from 'jspdf';
import { KycRecord, PhoneInventoryItem, ShapathLanguage, UserProfile } from '../types';

/**
 * Generates an A4 legally formatted Shapath Patra (Affidavit) PDF combining:
 * - Shop header & Stock code
 * - Seller details & masked government ID
 * - Complete phone specifications, IMEI, condition & grade
 * - Legal Shapath Patra declaration clauses (English / Hindi transliterated & bilingual)
 * - Embedded ID Front/Back photos & Digital Signature
 */
export function generateShapathPatraPdf(
  phone: PhoneInventoryItem,
  kyc: KycRecord,
  shop: UserProfile,
  language: ShapathLanguage = 'Hindi',
  mode: 'download' | 'print' = 'download'
): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Outer document border
  doc.setDrawColor(15, 123, 73);
  doc.setLineWidth(0.6);
  doc.rect(10, 10, 190, 277);

  // Header Banner
  doc.setFillColor(240, 253, 244);
  doc.rect(11, 11, 188, 28, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(17, 24, 39);
  doc.text(shop.shopName || 'CM Inventory Management', 105, 22, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(75, 85, 99);
  const subHeaderParts = [
    shop.city ? shop.city : null,
    shop.phone ? `Phone: ${shop.phone}` : null,
    shop.email ? `Email: ${shop.email}` : null,
  ].filter(Boolean);
  doc.text(
    subHeaderParts.length > 0 ? subHeaderParts.join('  |  ') : 'Verified Mobile Store & KYC Register',
    105,
    29,
    { align: 'center' }
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 123, 73);
  const titleText =
    language === 'English'
      ? 'USED MOBILE PURCHASE AFFIDAVIT (SHAPATH PATRA)'
      : 'SHAPATH PATRA — PURANA MOBILE BIKRI GHOSHNA PATRA';
  doc.text(titleText, 105, 36, { align: 'center' });

  // Metadata bar
  doc.setDrawColor(229, 231, 235);
  doc.line(14, 42, 196, 42);

  doc.setFontSize(9.5);
  doc.setTextColor(17, 24, 39);
  doc.setFont('helvetica', 'bold');
  doc.text(`Receipt / Stock No: ${phone.stockCode}`, 15, 48);
  doc.text(`Date: ${phone.purchaseDate || kyc.dateLabel} ${new Date().getFullYear()}`, 105, 48, { align: 'center' });
  doc.text(`Grade: Grade ${phone.grade} (${phone.checksPassed}/8 OK)`, 195, 48, { align: 'right' });

  doc.line(14, 52, 196, 52);

  // Section 1: Device Specifications Box
  doc.setFillColor(249, 250, 251);
  doc.rect(14, 56, 182, 36, 'F');
  doc.setDrawColor(209, 213, 219);
  doc.rect(14, 56, 182, 36);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 123, 73);
  doc.text('1. DEVICE DETAILS (MOBILE VIVARAN)', 18, 63);

  doc.setFontSize(9.5);
  doc.setTextColor(31, 41, 55);
  doc.setFont('helvetica', 'bold');
  doc.text('Brand & Model:', 18, 71);
  doc.setFont('helvetica', 'normal');
  doc.text(`${phone.brand} ${phone.model}`, 50, 71);

  doc.setFont('helvetica', 'bold');
  doc.text('RAM / Storage:', 115, 71);
  doc.setFont('helvetica', 'normal');
  doc.text(`${phone.ram} / ${phone.storage} (${phone.colour || 'Black'})`, 145, 71);

  doc.setFont('helvetica', 'bold');
  doc.text('IMEI 1:', 18, 79);
  doc.setFont('courier', 'bold');
  doc.text(phone.imei, 50, 79);

  doc.setFont('helvetica', 'bold');
  doc.text('Accessories:', 115, 79);
  doc.setFont('helvetica', 'normal');
  doc.text(phone.accessories.length > 0 ? phone.accessories.join(', ') : 'Phone Only', 145, 79);

  doc.setFont('helvetica', 'bold');
  doc.text('Purchase Price:', 18, 87);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 123, 73);
  doc.text(`Rs. ${phone.buyingPrice.toLocaleString('en-IN')}/- (${phone.paymentMethod})`, 50, 87);

  doc.setTextColor(31, 41, 55);
  doc.text('Battery Health:', 115, 87);
  doc.setFont('helvetica', 'normal');
  doc.text(`${phone.batteryHealth}%`, 145, 87);

  // Section 2: Seller KYC Details
  doc.setFillColor(249, 250, 251);
  doc.rect(14, 96, 182, 32, 'F');
  doc.rect(14, 96, 182, 32);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 123, 73);
  doc.text('2. SELLER KYC DETAILS (VIKRETA KA VIVARAN)', 18, 103);

  doc.setFontSize(9.5);
  doc.setTextColor(31, 41, 55);
  doc.text('Seller Name:', 18, 111);
  doc.setFont('helvetica', 'normal');
  doc.text(phone.sellerName, 50, 111);

  doc.setFont('helvetica', 'bold');
  doc.text('Mobile No:', 115, 111);
  doc.setFont('helvetica', 'normal');
  doc.text(`+91 ${phone.sellerMobile}`, 145, 111);

  doc.setFont('helvetica', 'bold');
  doc.text('ID Proof Type:', 18, 118);
  doc.setFont('helvetica', 'normal');
  doc.text(`${phone.idType} (${phone.idMasked})`, 50, 118);

  doc.setFont('helvetica', 'bold');
  doc.text('KYC Status:', 115, 118);
  doc.setFont('helvetica', 'normal');
  doc.text('ID Verified & Signed', 145, 118);

  doc.setFont('helvetica', 'bold');
  doc.text('Full Address:', 18, 125);
  doc.setFont('helvetica', 'normal');
  doc.text(phone.sellerAddress.slice(0, 85), 50, 125);

  // Section 3: Shapath Patra Legal Clauses
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 123, 73);
  doc.text('3. SELLER DECLARATION / SHAPATH PATRA CLAUSES', 15, 136);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(31, 41, 55);

  const clausesHindi = [
    `1. Main, ${phone.sellerName}, shapath purvak ghoshna karta/karti hoon ki upar likha mobile (${phone.brand} ${phone.model}, IMEI: ${phone.imei}) mera swayam ka hai.`,
    `2. Maine yah mobile ${shop.shopName} ko Rs. ${phone.buyingPrice.toLocaleString('en-IN')}/- (${phone.paymentMethod}) mein apni marzi se becha hai aur poori rashi prapt kar li hai.`,
    `3. Yah mobile chori ka nahi hai, na hi is par koi EMI / Finance baki hai, aur na hi kisi police prakaran mein shamil hai.`,
    `4. Bechnay ki tarikh se pehle agar is IMEI / mobile se koi bhi kanooni vivad ya cyber crime juda paya jata hai, toh uski sampurn jimmedari meri (${phone.sellerName}) hogi.`,
    `5. Maine apna asli pehchan patra (${phone.idType}: ${phone.idMasked}) jama kiya hai aur neeche apne hastakshar kiye hain.`,
  ];

  const clausesEnglish = [
    `1. I, ${phone.sellerName}, solemnly declare that the mobile phone (${phone.brand} ${phone.model}, IMEI: ${phone.imei}) is my rightful legal property.`,
    `2. I have willingly sold this mobile phone to ${shop.shopName} for Rs. ${phone.buyingPrice.toLocaleString('en-IN')}/- via ${phone.paymentMethod} and received full payment.`,
    `3. This device is NOT stolen, has NO pending finance/loan/EMI lock, and is not involved in any unlawful activity.`,
    `4. I shall bear sole legal responsibility for any prior dispute, complaint, or issue associated with this IMEI prior to the date and time of this sale.`,
    `5. My government ID (${phone.idType}: ${phone.idMasked}) and live photograph provided herewith are true and authentic.`,
  ];

  let yPos = 143;
  const activeClauses =
    language === 'Hindi'
      ? clausesHindi
      : language === 'English'
      ? clausesEnglish
      : [...clausesHindi.slice(0, 3), ...clausesEnglish.slice(0, 3)];

  activeClauses.forEach((clause) => {
    const lines = doc.splitTextToSize(clause, 180);
    doc.text(lines, 15, yPos);
    yPos += lines.length * 4.6 + 1.8;
  });

  // Section 4: Attached KYC Proofs & Digital Signature
  const mediaBoxY = Math.max(yPos + 4, 198);
  doc.setDrawColor(209, 213, 219);
  doc.line(14, mediaBoxY - 3, 196, mediaBoxY - 3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 123, 73);
  doc.text('4. ATTACHED KYC ID PROOF & DIGITAL SIGNATURE', 15, mediaBoxY + 3);

  // Add ID Front Photo if available
  try {
    if (kyc.idFrontUrl && kyc.idFrontUrl.startsWith('data:image')) {
      doc.addImage(kyc.idFrontUrl, 'JPEG', 15, mediaBoxY + 7, 52, 32);
    } else {
      doc.rect(15, mediaBoxY + 7, 52, 32);
      doc.setFontSize(8);
      doc.text('ID Front Verified', 25, mediaBoxY + 24);
    }
  } catch {
    doc.rect(15, mediaBoxY + 7, 52, 32);
  }
  doc.setFontSize(8);
  doc.setTextColor(75, 85, 99);
  doc.text(`ID Front (${phone.idMasked})`, 15, mediaBoxY + 43);

  // Add ID Back Photo if available
  try {
    if (kyc.idBackUrl && kyc.idBackUrl.startsWith('data:image')) {
      doc.addImage(kyc.idBackUrl, 'JPEG', 73, mediaBoxY + 7, 52, 32);
    } else {
      doc.rect(73, mediaBoxY + 7, 52, 32);
      doc.setFontSize(8);
      doc.text('ID Back Verified', 83, mediaBoxY + 24);
    }
  } catch {
    doc.rect(73, mediaBoxY + 7, 52, 32);
  }
  doc.text('ID Back (Address Verified)', 73, mediaBoxY + 43);

  // Add Seller Digital Signature
  doc.rect(133, mediaBoxY + 7, 62, 32);
  try {
    if (kyc.signatureDataUrl && kyc.signatureDataUrl.startsWith('data:image')) {
      doc.addImage(kyc.signatureDataUrl, 'PNG', 135, mediaBoxY + 9, 58, 28);
    }
  } catch {
    // Signature frame fallback
  }
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(17, 24, 39);
  doc.text(`Seller Sign: ${phone.sellerName}`, 133, mediaBoxY + 43);

  // Bottom Shop Stamp & Footer
  doc.setDrawColor(229, 231, 235);
  doc.line(14, 265, 196, 265);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(107, 114, 128);
  doc.text(`Generated via CM Inventory Management KYC System · Stock ID: ${phone.stockCode}`, 15, 272);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 123, 73);
  doc.text(`Authorized Signatory — ${shop.shopName}`, 195, 272, { align: 'right' });

  const fileName = `Shapath_Patra_${phone.stockCode}_${phone.sellerName.replace(/\s+/g, '_')}.pdf`;

  if (mode === 'print') {
    doc.autoPrint();
    const blobUrl = doc.output('bloburl');
    window.open(blobUrl, '_blank');
  } else {
    doc.save(fileName);
  }
}

/**
 * Generates and downloads the complete KYC Register PDF in one click
 */
export function generateKycRegisterPdf(
  records: KycRecord[],
  shop: UserProfile,
  periodLabel = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }),
  mode: 'download' | 'print' = 'download'
): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Header
  doc.setFillColor(15, 123, 73);
  doc.rect(10, 10, 190, 22, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(`${shop.shopName || 'CM Inventory Management'} — OFFICIAL KYC REGISTER`, 15, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Generated: ${periodLabel}   |   Total Records: ${records.length}   |   100% KYC Verified`, 15, 27);

  // Table Headers
  let y = 40;
  doc.setFillColor(243, 244, 246);
  doc.rect(10, y - 5, 190, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(55, 65, 81);
  doc.text('DATE', 12, y);
  doc.text('STOCK ID', 30, y);
  doc.text('PHONE / MODEL', 54, y);
  doc.text('15-DIGIT IMEI', 98, y);
  doc.text('SELLER / PARTY', 136, y);
  doc.text('ID LAST 4', 168, y);
  doc.text('PRICE', 198, y, { align: 'right' });

  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  if (records.length === 0) {
    doc.setTextColor(107, 114, 128);
    doc.text('No KYC transactions recorded yet for this account.', 105, y + 6, {
      align: 'center',
    });
  }

  records.forEach((rec, index) => {
    if (y > 272) {
      doc.addPage();
      y = 20;
    }

    if (index % 2 === 1) {
      doc.setFillColor(249, 250, 251);
      doc.rect(10, y - 4.5, 190, 7.5, 'F');
    }

    const todayShort = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    });
    doc.setTextColor(17, 24, 39);
    doc.text(rec.dateLabel || todayShort, 12, y);
    doc.text(rec.stockCode || `OP-${index + 1}`, 30, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`${rec.brand} ${rec.model}`.slice(0, 22), 54, y);
    doc.setFont('courier', 'normal');
    doc.text(rec.imei, 98, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${rec.partyName}`.slice(0, 16), 136, y);
    doc.text(`XXXX-${rec.idLast4}`, 168, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 123, 73);
    doc.text(`Rs.${rec.price.toLocaleString('en-IN')}`, 198, y, { align: 'right' });

    y += 7.5;
  });

  // Footer
  doc.setDrawColor(209, 213, 219);
  doc.line(10, 280, 200, 280);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text(
    `Certified Police & Shop KYC Compliance Register · ${shop.shopName} · Generated by CM Inventory Management`,
    105,
    285,
    { align: 'center' }
  );

  if (mode === 'print') {
    doc.autoPrint();
    const blobUrl = doc.output('bloburl');
    window.open(blobUrl, '_blank');
  } else {
    doc.save(`KYC_Register_${(shop.shopName || 'Shop').replace(/\s+/g, '_')}.pdf`);
  }
}

/**
 * Generates a Sale Receipt PDF when a phone is sold from stock
 */
export function generateSaleBillPdf(
  phone: PhoneInventoryItem,
  shop: UserProfile,
  buyerName: string,
  buyerMobile: string,
  sellingPrice: number,
  paymentMethod: string
): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  doc.setDrawColor(15, 123, 73);
  doc.rect(12, 12, 186, 145);

  doc.setFillColor(15, 123, 73);
  doc.rect(12, 12, 186, 22, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(`${shop.shopName || 'CM Inventory Management'} — SALE RECEIPT`, 18, 25);

  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  doc.text(`Stock Code: ${phone.stockCode}`, 18, 44);
  doc.text(`Buyer Name: ${buyerName}`, 18, 52);
  doc.text(`Buyer Mobile: +91 ${buyerMobile}`, 18, 60);

  doc.text(`Device: ${phone.brand} ${phone.model} (${phone.ram}/${phone.storage})`, 18, 74);
  doc.text(`IMEI: ${phone.imei}`, 18, 82);
  doc.text(`Grade: Grade ${phone.grade} (${phone.batteryHealth}% Battery)`, 18, 90);
  doc.text(`Included: ${phone.accessories.join(', ') || 'Phone Only'}`, 18, 98);

  doc.setFontSize(13);
  doc.setTextColor(15, 123, 73);
  doc.text(
    `Total Amount Paid: Rs. ${sellingPrice.toLocaleString('en-IN')}/- (${paymentMethod})`,
    18,
    114
  );

  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text('Thank you for purchasing from our verified pre-owned mobile store.', 18, 145);

  doc.save(`Sale_Bill_${phone.stockCode}_${buyerName.replace(/\s+/g, '_')}.pdf`);
}
