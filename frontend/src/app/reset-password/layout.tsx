import type { Metadata } from "next";

// Metadata-only layout for the standalone password-reset page —
// it is a private account page, so keep it out of search indexes.
// Renders no extra DOM (passes children straight through), so the
// page's UI and behaviour are unchanged.
export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};

export default function ResetPasswordLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
