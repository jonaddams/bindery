import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/product';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Taken from the one constant rather than written out again: the browser title
// said "Nutrient API CRUD App" for months while every message the app sent said
// "Bindery", and this is the class of disagreement that has cost this project a
// carrier review already.
export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script
          src={`https://cdn.cloud.pspdfkit.com/pspdfkit-web@${process.env.NUTRIENT_VIEWER_VERSION}/nutrient-viewer.js`}
          strategy="beforeInteractive"
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* BetterAuth's client keeps session state in a store rather than React
            context, so no session provider is needed here. */}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
