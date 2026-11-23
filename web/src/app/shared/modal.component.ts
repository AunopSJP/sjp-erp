import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, inject } from '@angular/core';

@Component({
  selector: 'app-modal',
  standalone: true,
  template: `
    <div class="modal-back" [class.aside-back]="side" (mousedown)="onBackdrop($event)">
      <div #dialog class="modal" [class.wide]="wide" [class.modal-aside]="side" role="dialog" aria-modal="true" tabindex="-1" [attr.aria-label]="title"
        (pointerup)="endDrag()"
        (pointercancel)="endDrag()">
        <div
          class="modal-grip"
          aria-hidden="true"
          (pointerdown)="startDrag($event)"
          (pointermove)="moveDrag($event)"
          (pointerup)="endDrag()"
          (pointercancel)="endDrag()"
        ></div>
        <div class="modal-head">
          <h3>{{ title }}</h3>
          <button type="button" class="btn ghost" (click)="closed.emit()" aria-label="ปิด">ปิด</button>
        </div>
        <div class="modal-body"><ng-content /></div>
        <div class="modal-foot"><ng-content select="[modal-footer]" /></div>
      </div>
    </div>
  `,
  styles: [`
    .aside-back { align-items: stretch; justify-content: flex-end; padding: 0; }
    .modal.modal-aside { max-width: 540px; height: 100%; max-height: 100dvh; border-radius: 0; }
    .modal.modal-aside .modal-body { flex: 1; }
    @media (max-width: 760px) {
      .modal.modal-aside { max-width: none; height: auto; max-height: 92dvh; margin-top: auto; border-radius: 18px 18px 0 0; }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalComponent implements AfterViewInit, OnDestroy {
  @Input() title = '';
  @Input() wide = false;
  @Input() side = false;
  @Output() closed = new EventEmitter<void>();

  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  private dialog: HTMLElement | null = null;
  private previousFocus: HTMLElement | null = null;
  private dragStartY: number | null = null;
  private dragOffset = 0;

  ngAfterViewInit(): void {
    this.dialog = this.host.nativeElement.querySelector('.modal') as HTMLElement | null;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = this.focusable()[0];
    if (first) first.focus();
    else this.dialog?.focus();
  }

  ngOnDestroy(): void {
    this.previousFocus?.focus?.();
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  /** Only the ≤760px layout is a bottom sheet, and only there can it be dragged. */
  private sheetMode(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= 760;
  }

  startDrag(event: PointerEvent): void {
    if (!this.sheetMode()) return;
    this.dragStartY = event.clientY;
    this.dragOffset = 0;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture?.(event.pointerId);
    this.dialog?.classList.add('dragging');
  }

  moveDrag(event: PointerEvent): void {
    if (this.dragStartY === null || !this.dialog) return;
    this.dragOffset = Math.max(0, event.clientY - this.dragStartY);
    this.dialog.style.transform = `translateY(${this.dragOffset}px)`;
  }

  endDrag(): void {
    if (this.dragStartY === null) return;
    const shouldClose = this.dragOffset > 96;
    this.dragStartY = null;
    this.dragOffset = 0;
    const dialog = this.dialog;
    if (!dialog) return;
    dialog.classList.remove('dragging');
    dialog.style.transform = '';
    if (shouldClose) {
      this.closed.emit();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closed.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusable();
    if (!items.length) {
      event.preventDefault();
      this.dialog?.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusable(): HTMLElement[] {
    if (!this.dialog) return [];
    return [...this.dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null);
  }
}
