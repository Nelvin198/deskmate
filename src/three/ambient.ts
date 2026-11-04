import {
	BufferGeometry,
	Color,
	EdgesGeometry,
	Float32BufferAttribute,
	Group,
	IcosahedronGeometry,
	LineBasicMaterial,
	LineSegments,
	PerspectiveCamera,
	Points,
	PointsMaterial,
	Scene,
	WebGLRenderer,
} from "three";

const FRAME_MS = 1000 / 30; // 30 fps is plenty for slow motion and saves battery.

/** Reads a CSS colour (which may use var(), hsl() or calc()) as the browser resolves it. */
function cssColor(host: HTMLElement, value: string): Color {
	const probe = host.createDiv("dm-probe");
	probe.setCssProps({ color: value });
	const resolved = getComputedStyle(probe).color;
	probe.remove();
	const match = resolved.match(/[\d.]+/g);
	if (!match || match.length < 3) return new Color(0x888888);
	return new Color(Number(match[0]) / 255, Number(match[1]) / 255, Number(match[2]) / 255);
}

/**
 * A slow wireframe shape and a faint field of points, drawn behind the header.
 * It only animates while it is on screen, the window is visible and the OS allows motion.
 */
export class AmbientScene {
	private renderer: WebGLRenderer;
	private scene = new Scene();
	private camera = new PerspectiveCamera(45, 1, 0.1, 100);
	private group = new Group();
	private shape: LineSegments;
	private points: Points;
	private shapeMaterial: LineBasicMaterial;
	private pointsMaterial: PointsMaterial;
	private win: Window;
	private frame = 0;
	private last = 0;
	private visible = true;
	private reducedMotion: MediaQueryList;
	private resizeObserver: ResizeObserver;
	private intersectionObserver: IntersectionObserver;
	private onVisibility = () => this.update();
	private onMotion = () => this.update();

	constructor(private host: HTMLElement) {
		this.win = host.win ?? window;
		this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.setPixelRatio(Math.min(this.win.devicePixelRatio || 1, 1.5));
		this.renderer.domElement.addClass("dm-ambient");
		this.renderer.domElement.setAttribute("aria-hidden", "true");
		host.prepend(this.renderer.domElement);

		this.camera.position.set(0, 0, 9);

		const base = new IcosahedronGeometry(2.6, 1);
		const edges = new EdgesGeometry(base);
		base.dispose();
		this.shapeMaterial = new LineBasicMaterial({ transparent: true, opacity: 0.35 });
		this.shape = new LineSegments(edges, this.shapeMaterial);

		const positions: number[] = [];
		for (let i = 0; i < 160; i++) {
			positions.push((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 8);
		}
		const dots = new BufferGeometry();
		dots.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.pointsMaterial = new PointsMaterial({ size: 0.05, transparent: true, opacity: 0.5 });
		this.points = new Points(dots, this.pointsMaterial);

		this.group.add(this.shape);
		this.scene.add(this.group, this.points);
		this.recolor();

		this.reducedMotion = this.win.matchMedia("(prefers-reduced-motion: reduce)");
		this.reducedMotion.addEventListener("change", this.onMotion);
		this.win.document.addEventListener("visibilitychange", this.onVisibility);

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(host);
		this.intersectionObserver = new IntersectionObserver((entries) => {
			this.visible = entries.some((e) => e.isIntersecting);
			this.update();
		});
		this.intersectionObserver.observe(host);
		this.resize();
	}

	/** Picks colours up from the current theme. Call again when the theme changes. */
	recolor(): void {
		this.shapeMaterial.color = cssColor(this.host, "var(--interactive-accent)");
		this.pointsMaterial.color = cssColor(this.host, "var(--text-muted)");
		this.render();
	}

	private resize(): void {
		const width = this.host.clientWidth;
		const height = this.host.clientHeight;
		if (!width || !height) return;
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		// Keep the shape to the right of the text on wide headers.
		this.group.position.x = width > 600 ? 3.2 : 0;
		this.camera.updateProjectionMatrix();
		this.render();
	}

	private get shouldAnimate(): boolean {
		return this.visible && this.win.document.visibilityState === "visible" && !this.reducedMotion.matches;
	}

	private update(): void {
		if (this.shouldAnimate && !this.frame) {
			this.last = 0;
			this.frame = this.win.requestAnimationFrame(this.tick);
		} else if (!this.shouldAnimate && this.frame) {
			this.win.cancelAnimationFrame(this.frame);
			this.frame = 0;
		}
		if (!this.shouldAnimate) this.render();
	}

	private tick = (time: number) => {
		this.frame = this.win.requestAnimationFrame(this.tick);
		if (this.last && time - this.last < FRAME_MS) return;
		const step = this.last ? Math.min(time - this.last, 100) / 1000 : 0;
		this.last = time;
		this.group.rotation.y += step * 0.12;
		this.group.rotation.x += step * 0.05;
		this.points.rotation.y += step * 0.015;
		this.render();
	};

	private render(): void {
		this.renderer.render(this.scene, this.camera);
	}

	dispose(): void {
		if (this.frame) this.win.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.resizeObserver.disconnect();
		this.intersectionObserver.disconnect();
		this.reducedMotion.removeEventListener("change", this.onMotion);
		this.win.document.removeEventListener("visibilitychange", this.onVisibility);
		this.shape.geometry.dispose();
		this.points.geometry.dispose();
		this.shapeMaterial.dispose();
		this.pointsMaterial.dispose();
		this.renderer.dispose();
		this.renderer.domElement.remove();
	}
}
