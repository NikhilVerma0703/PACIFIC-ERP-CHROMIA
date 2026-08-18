import Link from "next/link";

const LINKS = [
  { key: "designs", href: "/robo/masters/designs", label: "Designs" },
  { key: "programs", href: "/robo/masters/programs", label: "Programs" },
  { key: "tools", href: "/robo/masters/tools", label: "Tools" },
  { key: "liquids", href: "/robo/masters/liquids", label: "Liquids" },
  { key: "powders", href: "/robo/masters/powders", label: "Powders" },
  { key: "operators", href: "/robo/masters/operators", label: "Operators" },
  { key: "delay-codes", href: "/robo/masters/delay-codes", label: "Delay codes" },
] as const;

export function MastersNav({ active }: { active: (typeof LINKS)[number]["key"] }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-1.5">
      {LINKS.map(l => (
        <Link
          key={l.key}
          href={l.href}
          className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
            l.key === active
              ? "bg-brand text-white"
              : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
