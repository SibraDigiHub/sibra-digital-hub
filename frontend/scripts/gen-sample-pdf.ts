// Generates a small valid PDF used as the demo deliverable file.
// Run: bun scripts/gen-sample-pdf.ts
import { writeFileSync, mkdirSync } from 'fs'

const lines: string[] = []
const add = (s: string) => lines.push(s)

add('BT /F1 20 Tf 60 760 Td (Atharva Digital Labs - Sample Deliverable) Tj ET')
add('BT /F1 12 Tf 60 725 Td (Congratulations! This is a demo deliverable file.) Tj ET')
add('BT /F1 12 Tf 60 705 Td (In production this is your real PDF/ZIP: prompts, scripts,) Tj ET')
add('BT /F1 12 Tf 60 687 Td (coloring packs or templates - delivered instantly by email.) Tj ET')
add('BT /F1 12 Tf 60 655 Td (Delivery pipeline: UPI payment -> webhook -> token -> this file.) Tj ET')
add('BT /F1 12 Tf 60 623 Td (Thank you for building with Atharva Digital Labs!) Tj ET')
const content = lines.join('\n')

const objs: string[] = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]

let pdf = '%PDF-1.4\n'
const offsets: number[] = []
objs.forEach((body, i) => {
  offsets.push(pdf.length)
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const xrefStart = pdf.length
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

mkdirSync('public/files', { recursive: true })
writeFileSync('public/files/sample-deliverable.pdf', pdf, 'binary')
console.log('✅ public/files/sample-deliverable.pdf created')
