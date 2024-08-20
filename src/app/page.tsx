import { Footer } from "~/components/layout/Footer";
import { ShootingStars } from "~/components/layout/ShootingStars";
import { CreateRoom } from "~/components/modal/CreateRoom";

export default function HomePage() {
  return (
    <div
      className="flex size-full grow flex-col items-center justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%)",
      }}
    >
      <ShootingStars />
      <main className="z-10 flex grow flex-col items-center justify-center text-white">
        <CreateRoom />
      </main>

      <Footer />
    </div>
  );
}
