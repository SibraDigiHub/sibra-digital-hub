import { LegalRoute, legalPageMetadata } from '@/components/real/legal-route'

export const metadata = legalPageMetadata('contact')

export default function ContactPage() {
  return <LegalRoute page="contact" />
}
