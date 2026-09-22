import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { useReveal } from '../components/useReveal';
import { Hero } from '../sections/Hero';
import { Features } from '../sections/Features';
import { HowItWorks } from '../sections/HowItWorks';
import { Pricing } from '../sections/Pricing';
import { FAQ } from '../sections/FAQ';
import { CtaBand } from '../sections/CtaBand';

export default function Landing() {
  useReveal();
  return (
    <>
      <Header />
      <main id="main">
        <Hero />
        <Features />
        <HowItWorks />
        <Pricing />
        <FAQ />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
