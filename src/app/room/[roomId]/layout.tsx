import { Footer } from "~/components/layout/Footer";
import { Navbar } from "~/components/layout/Navbar";

export default function RoomLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Navbar />
      {children}
      <Footer />
    </>
  );
}
