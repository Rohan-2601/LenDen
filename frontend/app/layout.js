import "./globals.css";
export const metadata = {
  title: "LenDen · Retention workspace",
  description: "Wholesale payment follow-up and customer retention simulator",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
