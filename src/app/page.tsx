import { Footer } from "~/components/layout/Footer";
import { CreateRoom } from "~/components/modal/CreateRoom";

export default function HomePage() {
  return (
    <>
      <main className="flex min-h-screen flex-col items-center justify-center text-white">
        <CreateRoom />
      </main>

      <Footer />
    </>
  );
}
