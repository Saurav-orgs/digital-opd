import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { useReveal } from '../components/useReveal';
import { Hero } from '../sections/Hero';
import { FindDoctor } from '../sections/FindDoctor';
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
        {/* Patients arrive here too — straight after the hero, before the
            pitch to doctors, because they came to book and nothing else on
            the page is for them. */}
        <FindDoctor />
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
