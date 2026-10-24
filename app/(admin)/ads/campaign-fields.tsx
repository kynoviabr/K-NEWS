import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { isoToSaoPauloLocal } from "@/lib/validations/ads.schema";

export type CampaignValues = {
  advertiser_id?: string;
  contract_id?: string | null;
  kind?: string;
  name?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  impressions_cap?: number | null;
  daily_impressions_cap?: number | null;
  frequency_cap_per_user?: number | null;
  priority?: number;
  pacing?: string;
  pricing_model?: string;
  rate_cents?: number;
  budget_cents?: number | null;
  disclosure_label?: string;
  device_targets?: string[];
  category_targets?: string[];
};

type Option = { id: string; label: string };

const cents = (v: number | null | undefined) => (v == null ? "" : (v / 100).toFixed(2).replace(".", ","));

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Campos compartilhados entre criar e editar campanha.
export function CampaignFields({ values = {}, advertisers, contracts }: { values?: CampaignValues; advertisers: Option[]; contracts: Option[] }) {
  const devices = new Set(values.device_targets ?? []);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Field id="name" label="Nome da campanha">
        <Input id="name" name="name" required defaultValue={values.name} placeholder="Verão no Perequê" />
      </Field>
      <Field id="advertiser_id" label="Anunciante">
        <Select id="advertiser_id" name="advertiser_id" required defaultValue={values.advertiser_id ?? ""}>
          <option value="" disabled>Escolha…</option>
          {advertisers.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </Select>
      </Field>
      <Field id="kind" label="Tipo" hint="Casa: produtos próprios, exibidos quando não há campanha paga nem provedor.">
        <Select id="kind" name="kind" defaultValue={values.kind ?? "direct"}>
          <option value="direct">Paga (contrato)</option>
          <option value="house">Da casa (fallback)</option>
        </Select>
      </Field>
      <Field id="contract_id" label="Contrato" hint="Obrigatório para campanha paga; precisa estar assinado para ativar.">
        <Select id="contract_id" name="contract_id" defaultValue={values.contract_id ?? ""}>
          <option value="">Sem contrato</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </Select>
      </Field>
      <Field id="starts_at" label="Início (horário de Brasília)">
        <Input id="starts_at" name="starts_at" type="datetime-local" defaultValue={isoToSaoPauloLocal(values.starts_at)} />
      </Field>
      <Field id="ends_at" label="Término (horário de Brasília)">
        <Input id="ends_at" name="ends_at" type="datetime-local" required defaultValue={isoToSaoPauloLocal(values.ends_at)} />
      </Field>
      <Field id="impressions_cap" label="Impressões contratadas" hint="Vazio = sem limite total.">
        <Input id="impressions_cap" name="impressions_cap" type="number" min={1} defaultValue={values.impressions_cap ?? ""} />
      </Field>
      <Field id="daily_impressions_cap" label="Limite diário">
        <Input id="daily_impressions_cap" name="daily_impressions_cap" type="number" min={1} defaultValue={values.daily_impressions_cap ?? ""} />
      </Field>
      <Field id="frequency_cap_per_user" label="Frequência por visitante/dia" hint="Só vale para quem aceitou o identificador.">
        <Input id="frequency_cap_per_user" name="frequency_cap_per_user" type="number" min={1} defaultValue={values.frequency_cap_per_user ?? ""} />
      </Field>
      <Field id="pacing" label="Ritmo de entrega">
        <Select id="pacing" name="pacing" defaultValue={values.pacing ?? "asap"}>
          <option value="asap">O mais rápido possível</option>
          <option value="even">Uniforme até o término</option>
        </Select>
      </Field>
      <Field id="priority" label="Prioridade (0–1000)">
        <Input id="priority" name="priority" type="number" min={0} max={1000} defaultValue={values.priority ?? 100} />
      </Field>
      <Field id="disclosure_label" label="Identificação exibida">
        <Input id="disclosure_label" name="disclosure_label" required defaultValue={values.disclosure_label ?? "Publicidade"} />
      </Field>
      <Field id="pricing_model" label="Cobrança">
        <Select id="pricing_model" name="pricing_model" defaultValue={values.pricing_model ?? "flat"}>
          <option value="flat">Valor fechado (contrato)</option>
          <option value="cpm">CPM</option>
          <option value="cpc">CPC</option>
        </Select>
      </Field>
      <Field id="rate_cents" label="Valor unitário (R$)" hint="CPM: por mil impressões. CPC: por clique.">
        <Input id="rate_cents" name="rate_cents" inputMode="decimal" defaultValue={cents(values.rate_cents)} placeholder="0,00" />
      </Field>
      <Field id="budget_cents" label="Orçamento (R$)" hint="Para CPM/CPC: a entrega para ao esgotar.">
        <Input id="budget_cents" name="budget_cents" inputMode="decimal" defaultValue={cents(values.budget_cents)} placeholder="opcional" />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Dispositivos</legend>
        <div className="flex gap-4 text-sm">
          {(["desktop", "mobile", "tablet"] as const).map((d) => (
            <label key={d} className="flex items-center gap-1.5">
              <input type="checkbox" name="device_targets" value={d} defaultChecked={devices.has(d)} />
              {{ desktop: "Computador", mobile: "Celular", tablet: "Tablet" }[d]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Nenhum marcado = todos.</p>
      </fieldset>
      <Field id="category_targets" label="Editorias" hint="Slugs separados por vírgula. Vazio = todas.">
        <Input id="category_targets" name="category_targets" defaultValue={(values.category_targets ?? []).join(", ")} placeholder="saude, cidade" />
      </Field>
    </div>
  );
}
