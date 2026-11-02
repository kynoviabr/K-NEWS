export type NavigationItem = {
  title: string;
  href: string;
  icon: string;
  description?: string;
};

export const navigationItems: NavigationItem[] = [
  { title: "Visão Geral", href: "/", icon: "LayoutDashboard", description: "KPIs e atividade" },
  { title: "Notícias", href: "/noticias", icon: "FileText" },
  { title: "Fontes", href: "/fontes", icon: "Globe" },
  { title: "Localidades", href: "/localidades", icon: "MapPin" },
  { title: "Redes Sociais", href: "/social", icon: "Share2" },
  { title: "Ad Management", href: "/ads", icon: "BadgeDollarSign" },
  { title: "Anunciantes", href: "/anunciantes", icon: "Building2" },
  { title: "Produtos/Afiliados", href: "/produtos", icon: "Package" },
  { title: "Comercial", href: "/comercial", icon: "BarChart3" },
  { title: "Parceiros", href: "/parceiros", icon: "Users" },
  { title: "Automações", href: "/automacoes", icon: "Workflow" },
];
