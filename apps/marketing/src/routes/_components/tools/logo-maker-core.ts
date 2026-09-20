export type LogoBackground =
	| { kind: 'solid'; color: string; opacity?: number }
	| {
			kind: 'gradient';
			from: string;
			to: string;
			angle: number;
			fromOpacity?: number;
			toOpacity?: number;
	  }
	| { kind: 'transparent' };

// Icons render through @lucide/svelte, which retains Lucide's ISC license in the installed package.
export const logoIconMetadata = {
	rocket: ['Rocket', 'launch startup space'],
	sparkles: ['Sparkles', 'magic shine star'],
	heart: ['Heart', 'love favorite care'],
	leaf: ['Leaf', 'nature eco plant'],
	mountain: ['Mountain', 'outdoors landscape adventure'],
	camera: ['Camera', 'photo photography media'],
	coffee: ['Coffee', 'cafe drink cup'],
	lightbulb: ['Idea', 'lightbulb innovation think'],
	zap: ['Lightning', 'zap energy fast'],
	globe: ['Globe', 'world global internet'],
	activity: ['Activity', 'health pulse signal'],
	airplay: ['Airplay', 'screen broadcast stream'],
	anchor: ['Anchor', 'marine nautical stable'],
	aperture: ['Aperture', 'lens photo focus'],
	award: ['Award', 'badge prize achievement'],
	banana: ['Banana', 'fruit food playful'],
	banknote: ['Banknote', 'money finance cash'],
	bell: ['Bell', 'notification alert'],
	bike: ['Bike', 'bicycle cycling sport'],
	bird: ['Bird', 'animal nature fly'],
	bookOpen: ['Open book', 'read education story'],
	bot: ['Bot', 'robot ai automation'],
	box: ['Box', 'package product cube'],
	briefcaseBusiness: ['Briefcase', 'business work professional'],
	brush: ['Brush', 'art paint creative'],
	building2: ['Building', 'company office city'],
	car: ['Car', 'auto vehicle transport'],
	cat: ['Cat', 'pet animal'],
	chefHat: ['Chef hat', 'food restaurant kitchen'],
	cloud: ['Cloud', 'weather storage hosted'],
	code2: ['Code', 'developer software programming'],
	compass: ['Compass', 'direction travel explore'],
	crown: ['Crown', 'premium royal king'],
	diamond: ['Diamond', 'gem luxury shape'],
	dog: ['Dog', 'pet animal'],
	dumbbell: ['Dumbbell', 'fitness gym strength'],
	earth: ['Earth', 'planet world global'],
	feather: ['Feather', 'writing light nature'],
	flame: ['Flame', 'fire hot trending'],
	flower2: ['Flower', 'nature bloom botanical'],
	gamepad2: ['Gamepad', 'game gaming play'],
	gem: ['Gem', 'jewel premium crystal'],
	headphones: ['Headphones', 'audio music sound'],
	house: ['House', 'home property'],
	keyRound: ['Key', 'security access password'],
	languages: ['Languages', 'translate global words'],
	mail: ['Mail', 'email message letter'],
	mapPin: ['Map pin', 'location place travel'],
	mic2: ['Microphone', 'podcast audio voice'],
	moon: ['Moon', 'night dark space'],
	music2: ['Music', 'song audio note'],
	orbit: ['Orbit', 'space science planet'],
	palette: ['Palette', 'art design color'],
	pawPrint: ['Paw', 'pet animal print'],
	plane: ['Plane', 'travel flight aviation'],
	shieldCheck: ['Shield', 'security trust protection'],
	shoppingBag: ['Shopping bag', 'store retail ecommerce'],
	smile: ['Smile', 'happy face friendly'],
	sun: ['Sun', 'weather light day'],
	treePine: ['Pine tree', 'forest nature outdoors'],
	trophy: ['Trophy', 'winner award success'],
	utensils: ['Utensils', 'food restaurant dining'],
	waves: ['Waves', 'water ocean sea'],
	wifi: ['Wi-Fi', 'wireless signal internet']
} as const;

export type LogoIconName = string;

export interface LogoDesign {
	icon: LogoIconName;
	iconColor: string;
	iconOpacity?: number;
	fillOpacity?: number;
	fillColor: string;
	iconSize: number;
	rotation: number;
	strokeWidth: number;
	background: LogoBackground;
	cornerRadius: number;
	padding: number;
	shadow: boolean;
}

export const exportSizes = [512, 1024, 2048, 4096] as const;
export type ExportSize = (typeof exportSizes)[number];

export const logoPresets: ReadonlyArray<{ name: string; design: LogoDesign }> = [
	{
		name: 'Launch',
		design: {
			icon: 'rocket',
			iconColor: '#FFFFFF',
			fillColor: 'none',
			iconSize: 58,
			rotation: -8,
			strokeWidth: 1.8,
			background: { kind: 'gradient', from: '#F97316', to: '#7C3AED', angle: 135 },
			cornerRadius: 28,
			padding: 18,
			shadow: true
		}
	},
	{
		name: 'Natural',
		design: {
			icon: 'leaf',
			iconColor: '#14532D',
			fillColor: '#86EFAC',
			iconSize: 62,
			rotation: 0,
			strokeWidth: 1.6,
			background: { kind: 'solid', color: '#DCFCE7' },
			cornerRadius: 50,
			padding: 18,
			shadow: false
		}
	},
	{
		name: 'Minimal',
		design: {
			icon: 'sparkles',
			iconColor: '#18181B',
			fillColor: 'none',
			iconSize: 52,
			rotation: 0,
			strokeWidth: 1.5,
			background: { kind: 'transparent' },
			cornerRadius: 0,
			padding: 22,
			shadow: false
		}
	}
];

export function serializeLogoSvg(svg: SVGSVGElement, size: ExportSize): string {
	const clone = svg.ownerDocument.importNode(svg, true);
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	clone.setAttribute('width', String(size));
	clone.setAttribute('height', String(size));
	clone.setAttribute('viewBox', '0 0 100 100');
	clone.removeAttribute('class');
	clone.removeAttribute('aria-label');
	return new XMLSerializer().serializeToString(clone);
}

export function svgBlob(svg: SVGSVGElement, size: ExportSize): Blob {
	return new Blob([serializeLogoSvg(svg, size)], { type: 'image/svg+xml;charset=utf-8' });
}
