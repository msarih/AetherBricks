/**
 * Écran d'échange avec un villageois : une ligne par offre (« ce que vous donnez → ce que
 * vous recevez »), un clic conclut l'échange. Les objets passent directement par l'inventaire :
 * pas de cases à remplir, contrairement à Minecraft, mais mêmes offres, mêmes prix et mêmes
 * paliers. Le jeu continue pendant l'échange.
 */
import { itemLabel } from '../world/Items';
import { button, el } from './dom';
import type { Screen, UiContext } from './Screen';
import { sized } from './Screens';
import type { TradeOfferView, TradeView } from './UiApi';

export class TradeScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = false;
  private readonly list: HTMLDivElement;
  private signature = '';
  private closedOnce = false;

  constructor(private readonly ctx: UiContext, private readonly view: TradeView) {
    this.el = el('div', 'mc-screen mc-screen-dim mc-menu');
    this.el.dataset.mc = 'trade';
    const title = el('div', 'mc-title', this.el, view.title);
    title.dataset.mc = 'trade-title';
    el('div', 'mc-trade-hint', this.el, 'Cliquez sur une offre pour conclure l’échange');
    this.list = el('div', 'mc-list mc-trade-list', this.el);
    this.list.dataset.mc = 'trade-list';
    sized(button(ctx.host, 'Terminé', () => this.finish(), 'trade-done', this.el), 200);
    this.refresh();
  }

  key(e: KeyboardEvent): boolean {
    if (e.code !== 'Escape' && e.code !== 'KeyE') return false;
    e.preventDefault();
    if (!e.repeat) this.finish();
    return true;
  }

  /** À chaque image : la liste suit l'inventaire et le réapprovisionnement du villageois. */
  update(): void {
    this.refresh();
  }

  dispose(): void {
    this.closed();
  }

  private closed(): void {
    if (this.closedOnce) return;
    this.closedOnce = true;
    this.view.closed();
  }

  private finish(): void {
    this.closed();
    if (!this.ctx.isCurrent(this)) return;
    this.ctx.closeScreen();
    this.ctx.host.game?.resume();
  }

  private refresh(): void {
    const offers = this.view.offers();
    const sig = offers.map((o) => `${o.buy}x${o.buyCount}+${o.buy2}x${o.buy2Count}>${o.sell}x${o.sellCount}:${o.soldOut ? 1 : 0}${o.affordable ? 1 : 0}`).join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    const top = this.list.scrollTop;
    this.list.textContent = '';
    offers.forEach((o, i) => this.row(o, i));
    this.list.scrollTop = top;
  }

  private row(o: TradeOfferView, index: number): void {
    const r = el('button', 'mc-trade-row', this.list);
    r.type = 'button';
    r.dataset.mc = `trade-offer-${index}`;
    r.disabled = o.soldOut || !o.affordable;
    if (o.soldOut) r.classList.add('mc-trade-out');
    const give = el('span', 'mc-trade-side', r);
    this.item(give, o.buy, o.buyCount, false);
    if (o.buy2 !== 0) {
      el('span', 'mc-trade-plus', give, '+');
      this.item(give, o.buy2, o.buy2Count, false);
    }
    el('span', 'mc-trade-arrow', r, o.soldOut ? '✕' : '→');
    const get = el('span', 'mc-trade-side', r);
    this.item(get, o.sell, o.sellCount, o.enchanted);
    r.title = o.soldOut ? 'Offre épuisée : le villageois doit se réapprovisionner' : o.affordable ? '' : 'Il vous manque de quoi payer';
    r.addEventListener('click', () => {
      if (r.disabled) return;
      this.ctx.host.click();
      if (this.view.trade(index)) {
        this.signature = '';
        this.refresh();
      }
    });
  }

  private item(parent: HTMLElement, id: number, count: number, enchanted: boolean): void {
    const box = el('span', 'mc-trade-item', parent);
    const icon = el('span', 'mc-stats-icon', box);
    const url = this.ctx.host.iconUrl(id);
    if (url) icon.style.backgroundImage = `url("${url}")`;
    const label = el('span', enchanted ? 'mc-trade-name mc-trade-enchanted' : 'mc-trade-name', box);
    label.textContent = `${count} × ${itemLabel(id)}${enchanted ? ' (enchanté)' : ''}`;
  }
}
