import { CustomerReviews } from '@/components/storefront/customer-reviews/customer-reviews';
import { DarkEdit } from '@/components/storefront/dark-edit/dark-edit';
import { FashionHeroSlider } from '@/components/storefront/fashion-hero/fashion-hero-slider';
import { Faq } from '@/components/storefront/faq/faq';
import { Newsletter } from '@/components/storefront/newsletter/newsletter';
import { WhyShopWithUs } from '@/components/storefront/why-shop-with-us/why-shop-with-us';

export default function Home() {
  return (
    <>
      {/* The page heading. The hero's oversized word is decorative and each slide carries its
          own h2. */}
      <h1 className="sr-only">EVORA — Modern essentials</h1>
      <FashionHeroSlider />
      <DarkEdit />
      <WhyShopWithUs />
      <CustomerReviews />
      <Newsletter />
      <Faq />
    </>
  );
}
