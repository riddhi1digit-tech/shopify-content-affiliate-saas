import { AppIcon, type AppIconName } from "./AppIcon";

type PageIntroProps = {
  icon: AppIconName;
  eyebrow: string;
  title: string;
  description: string;
};

export function PageIntro({ icon, eyebrow, title, description }: PageIntroProps) {
  return (
    <section className="merchant-page-intro">
      <span className="merchant-page-intro-icon"><AppIcon name={icon} size={23} /></span>
      <div>
        <p className="merchant-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}
