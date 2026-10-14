# Dose Diária 💊

PWA para marcar se você tomou seus remédios e suplementos no dia, com histórico e lembretes por notificação no iPhone.

- **Seus registros ficam só no aparelho** (LocalStorage). Nada de dose tomada vai para o servidor.
- **O servidor só guarda** a inscrição de push do aparelho e os horários dos lembretes.
- Front-end em HTML/CSS/JS puro, sem build. Backend: funções da Vercel + Upstash Redis.

## Como funciona

```
iPhone (PWA)  ──POST /api/subscribe──▶  Vercel  ──▶  Upstash Redis
                                         ▲               (inscrição + horários)
cron-job.org ──GET /api/cron (1/min)─────┘
                                         │
                                         └──▶ Apple Push ──▶ notificação no iPhone
```

A Vercel gratuita (Hobby) só permite cron 1x por dia, por isso o cron-job.org chama a rota `/api/cron` a cada minuto. Se uma chamada atrasar, a rota recupera até 15 minutos de lembretes perdidos, e o Redis impede notificação duplicada.

## Estrutura

```
public/          → o app (servido como site estático)
  index.html, styles.css, app.js, sw.js, manifest.webmanifest, icons/
api/             → funções da Vercel
  config.js        GET  chave pública VAPID
  subscribe.js     POST salva inscrição + horários
  unsubscribe.js   POST remove inscrição
  test.js          POST envia notificação de teste
  cron.js          GET  dispara os lembretes (protegido por CRON_SECRET)
lib/             → código compartilhado do servidor
tests/           → testes da lógica de agendamento (npm test)
```

---

## Deploy passo a passo

### 1. Gerar as chaves VAPID (uma vez)

Na pasta do projeto:

```bash
npm install
npm run vapid
```

Guarde a **Public Key** e a **Private Key** que aparecerem. A privada nunca vai para o código, só para as variáveis de ambiente.

Gere também uma senha longa para o cron (qualquer string aleatória serve):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Subir para o GitHub e importar na Vercel

1. Crie um repositório e suba a pasta (o `.gitignore` já ignora `node_modules` e `.env`).
2. Na Vercel: **Add New › Project** › importe o repositório.
3. Framework Preset: **Other**. Não precisa de Build Command. O `vercel.json` já define a pasta `public`.
4. Faça o deploy (vai funcionar como site; os lembretes ainda não).

### 3. Criar o Upstash Redis

1. No projeto da Vercel: aba **Storage › Create Database › Upstash (Redis)**.
2. Escolha o plano **Free** e uma região próxima (ex.: São Paulo, se disponível, ou us-east-1).
3. Conecte ao projeto. A Vercel cria sozinha as variáveis `KV_REST_API_URL` / `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). O código aceita os dois nomes.

### 4. Variáveis de ambiente

Em **Settings › Environment Variables**, adicione (ambiente Production):

| Nome | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | Public Key do passo 1 |
| `VAPID_PRIVATE_KEY` | Private Key do passo 1 |
| `VAPID_SUBJECT` | `mailto:seu-email@exemplo.com` |
| `CRON_SECRET` | a senha aleatória do passo 1 |

Depois: **Deployments › … › Redeploy** para as variáveis valerem.

### 5. Configurar o cron-job.org

1. Crie uma conta gratuita em https://cron-job.org
2. **Create cronjob**:
   - URL: `https://SEU-APP.vercel.app/api/cron`
   - Execution schedule: **Every 1 minute**
   - Aba **Advanced › Headers**: adicione `Authorization` com o valor `Bearer SEU_CRON_SECRET` (com a palavra *Bearer* e um espaço antes da senha)
   - Request method: **GET**
3. Salve e use **Test run**: a resposta deve ser `200` com algo como `{"ok":true,"subscriptions":0,"sent":0}`. Se vier `401`, o cabeçalho está errado.

### 6. Instalar no iPhone

Requer **iOS 16.4 ou superior**.

1. Abra o site no **Safari**.
2. **Compartilhar › Adicionar à Tela de Início**.
3. Abra o **Dose Diária pelo ícone** (não pelo Safari).
4. Vá em **Ajustes › Ativar lembretes › Permitir**.
5. Toque em **Testar**: a notificação deve chegar em poucos segundos.
6. Edite cada item e defina o horário de cada dose.

> Toda vez que você muda um horário, o app envia a lista nova ao servidor automaticamente.

---

## Compartilhando com outras pessoas

- Na primeira abertura aparece uma tela de boas-vindas com o passo a passo de instalação (iPhone ou Android) e a nota de privacidade. Ela pode ser reaberta em **Ajustes › Sobre › Como instalar**.
- Quem abre o link pelo Instagram, Facebook, Threads ou TikTok cai no navegador interno desses apps, onde não dá para instalar nem receber lembretes. O app detecta isso e mostra como abrir no Safari ou no Chrome.
- Cada pessoa tem seus próprios dados no próprio celular. Ninguém vê os registros de ninguém, nem você.
- O servidor guarda, de quem ativa lembretes, só o nome dos itens e os horários (isso aparece na nota de privacidade).

## Uso no dia a dia

- **Dia**: toque numa dose para marcar (registra a hora atual). Toque numa dose marcada para corrigir o horário ou desmarcar. Use as setas para ir a dias anteriores e marcar retroativamente.
- **Histórico**: calendário colorido (completo, parcial, nada marcado), dias seguidos completos e % de doses por item no mês. Toque num dia para abri-lo.
- **Ajustes**: itens (nome, ícone, doses por dia, horário do lembrete de cada dose), lembretes e backup.

Detalhes das regras:
- Mudar a quantidade de doses vale **a partir de hoje**; dias anteriores mantêm a quantidade antiga.
- Remover um item **mantém o histórico** dos dias em que ele existia.
- O lembrete chega **sempre no horário**, mesmo que você já tenha marcado a dose (o servidor não conhece seus registros).

## Backup

Os dados ficam no LocalStorage do app instalado. No iPhone, um PWA na Tela de Início não sofre a limpeza automática de 7 dias do Safari, mas os dados somem se você **remover o app** ou trocar de aparelho. Use **Ajustes › Exportar** de vez em quando (abre a folha de compartilhamento: salve em Arquivos/iCloud) e **Importar** para restaurar.

## Custos (plano gratuito)

- Cron a cada minuto ≈ 43 mil chamadas/mês, cada uma com 3 a 4 comandos no Redis ≈ 175 mil comandos/mês. O Upstash gratuito dá 500 mil/mês.
- O servidor aceita no máximo 100 aparelhos com lembretes (`MAX_SUBSCRIPTIONS` em `lib/server.js`). Quando lota, quem tenta ativar recebe um aviso e continua usando o app sem notificações.
- Mais pessoas quase não aumentam o consumo do Redis: o cron lê todos os aparelhos num único comando, e cada lembrete enviado custa só mais um.

## Desenvolvimento

```bash
npm test                      # testes da lógica de agendamento
npx vercel dev                # roda front + /api localmente (precisa do .env, veja .env.example)
```

Ao alterar arquivos do front, troque a versão do cache em `public/sw.js` (`dose-diaria-v1` → `v2`) para o iPhone pegar a atualização mais rápido.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Botão "Ativar lembretes" não aparece no iPhone | App aberto pelo Safari, não pelo ícone da Tela de Início |
| "Servidor sem chave VAPID configurada" | Variáveis do passo 4 ausentes ou sem redeploy |
| Teste funciona, mas lembrete não chega | cron-job.org desativado ou com `401` (veja o histórico de execuções lá) |
| Lembrete chega com até 1 min de atraso | Normal: o cron roda de minuto em minuto |
| Notificação não aparece com o iPhone em Foco/Não Perturbe | Libere o Dose Diária no modo Foco |
