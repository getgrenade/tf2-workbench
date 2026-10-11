import test from "node:test";
import assert from "node:assert/strict";
import { parseKv, printKv, findKv, KvError } from "../../src/compiler/kv";
import { buildVmt, DEFAULT_MATERIAL, flattenVmt, vmtText } from "../../src/compiler/vmt";

/** The material the in-game importer wrote for an unpainted hat with only a colour texture (a_cowboyhat). */
const IMPORTER_OUTPUT = `"VertexLitGeneric"
{
	"$basetexture"		"models/workshop/player/items/sniper/a_cowboyhat/a_cowboyhat_color"
	"$lightwarptexture"		"models/player/pyro/pyro_lightwarp"
	"$phong"		"1"
	"$phongexponent"		"25"
	"$phongboost"		"0.100000"
	"$phongfresnelranges"		"[.25 .5 1]"
	"$rimlight"		"1"
	"$rimlightexponent"		"4"
	"$rimlightboost"		"2"
	"$color2"		"{ 255 255 255 }"
	"$bumpmapalphaphongmask"		"1"
	"$cloakPassEnabled"		"1"
	"$detail"		"effects/tiledfire/fireLayeredSlowTiled512"
	"$detailscale"		"5"
	"$detailblendfactor"		"0"
	"$detailblendmode"		"6"
	"$yellow"		"0"
	">=DX90"
	{
		"$selfillum"		"0"
	}
	"proxies"
	{
		"invis"
		{
		}
		"AnimatedTexture"
		{
			"animatedtexturevar"		"$detail"
			"animatedtextureframenumvar"		"$detailframe"
			"animatedtextureframerate"		"30"
		}
		"BurnLevel"
		{
			"resultVar"		"$detailblendfactor"
		}
		"YellowLevel"
		{
			"resultVar"		"$yellow"
		}
		"Equals"
		{
			"srcVar1"		"$yellow"
			"resultVar"		"$color2"
		}
	}
}
`;

test("KeyValues text parses and prints the way the game's files look", () => {
  const nodes = parseKv(`// comment\n"Shader" { "$a" "1" b 2 "blk" { "$c" "x y" } }`);
  assert.equal(nodes[0].key, "Shader");
  assert.equal(findKv(nodes, "Shader/blk/$c")?.value, "x y");
  assert.equal(printKv(nodes), `"Shader"\n{\n\t"$a"\t\t"1"\n\t"b"\t\t"2"\n\t"blk"\n\t{\n\t\t"$c"\t\t"x y"\n\t}\n}\n`);
  assert.throws(() => parseKv(`"a" {`), KvError);
  assert.throws(() => parseKv(`"a"`), KvError);
});

test("the default material prints exactly what the importer writes for a hat with a colour texture", () => {
  const text = vmtText(buildVmt(DEFAULT_MATERIAL, { color: "models/workshop/player/items/sniper/a_cowboyhat/a_cowboyhat_color" }));
  assert.equal(text, IMPORTER_OUTPUT);
});

test("settings switch the parameters on, and the ones that are off disappear", () => {
  const kv = buildVmt({ ...DEFAULT_MATERIAL, paintable: true, translucent: true, alphaTest: true, selfIllum: true, halfLambert: true, envmap: "env_cubemap", phongExponent: 60 },
    { color: "a_color", normal: "a_normal", phongexponent: "a_exp", illum: "a_illum" });
  const text = vmtText(kv);
  assert.match(text, /"\$basetexture"\t\t"a_color"/);
  assert.match(text, /"\$bumpmap"\t\t"a_normal"/);
  assert.match(text, /"\$phongexponenttexture"\t\t"a_exp"/);
  assert.match(text, /"\$selfillummask"\t\t"a_illum"/);
  assert.match(text, /"\$phongexponent"\t\t"60\.000000"/);
  assert.match(text, /"\$translucent"\t\t"1"/);
  assert.match(text, /"\$alphatest"\t\t"0"|"\$alphatest"\t\t"1"/);
  assert.match(text, /"\$halflambert"\t\t"1"/);
  assert.match(text, /"\$envmap"\t\t"env_cubemap"/);
  assert.match(text, /"\$blendtintbybasealpha"/); // paintable keeps the paint chain
  assert.match(text, /"ItemTintColor"/);
  assert.match(text, /"Multiply"/);
  assert.doesNotMatch(text, /"Equals"/, "a paintable item multiplies by the yellow instead");
  const plain = vmtText(buildVmt(DEFAULT_MATERIAL, { color: "c" }));
  for (const gone of ["\"$bumpmap\"", "$halflambert", "$translucent", "$alphatest", "$envmap", "$selfillumtint", "$blendtintbybasealpha", "ItemTintColor", "SelectFirstIfNonZero", "Multiply", "$rimmask"]) assert.ok(!plain.includes(gone), gone);
});

test("a material flattens into the parameters and proxies a preview is built from", () => {
  const flat = flattenVmt(buildVmt(DEFAULT_MATERIAL, { color: "x" }));
  assert.equal(flat.shader, "vertexlitgeneric");
  assert.equal(flat.params["$basetexture"], "x");
  assert.equal(flat.params["$selfillum"], "0", "the >=DX90 block is folded in");
  assert.equal(flat.params["$detailblendmode"], "6");
  assert.deepEqual(flat.proxies.map((p) => p.name), ["invis", "animatedtexture", "burnlevel", "yellowlevel", "equals"]);
  assert.equal(flat.proxies[2].params["resultvar"], "$detailblendfactor");
});

// --- the proxies an artist adds by hand ---------------------------------------------------------------------------------------------

import { settingsFromVmt } from "../../src/compiler/importSession";
import { proxiesFromText, proxiesToText, proxyProblems, newProxy } from "../../src/compiler/proxyModel";

const PULSE = { name: "Sine", params: [{ key: "sineperiod", value: "0.500000" }, { key: "sinemin", value: "0.100000" }, { key: "sinemax", value: "1.800000" }, { key: "resultVar", value: "$selfillumtint" }] };
const SCROLL = { name: "TextureScroll", params: [{ key: "texturescrollvar", value: "$basetexturetransform" }, { key: "texturescrollrate", value: "1.200000" }, { key: "texturescrollangle", value: "0" }] };

test("proxies added by hand are written after the importer's, keys in the case and order they were given", () => {
  const text = vmtText(buildVmt({ ...DEFAULT_MATERIAL, selfIllum: true, customProxies: [PULSE, SCROLL] }, { color: "models/x/a" }));
  const block = text.slice(text.indexOf('"proxies"'));
  assert.ok(block.indexOf('"BurnLevel"') < block.indexOf('"Sine"'), "after the importer's own");
  assert.ok(block.indexOf('"Sine"') < block.indexOf('"TextureScroll"'), "in list order");
  assert.ok(block.includes('\t\t"Sine"\n\t\t{\n\t\t\t"sineperiod"\t\t"0.500000"\n\t\t\t"sinemin"\t\t"0.100000"\n\t\t\t"sinemax"\t\t"1.800000"\n\t\t\t"resultVar"\t\t"$selfillumtint"\n\t\t}\n'));
  // and they are what the preview material runs
  const { proxies } = flattenVmt(buildVmt({ ...DEFAULT_MATERIAL, customProxies: [PULSE, SCROLL] }, {}));
  assert.deepEqual(proxies.slice(-2).map((p) => p.name), ["sine", "texturescroll"]);
  assert.equal(proxies.at(-2)!.params["sinemax"], "1.800000");
});

test("a material without the artist's proxies prints as before, and one with them is read back with them", () => {
  const plain = vmtText(buildVmt(DEFAULT_MATERIAL, { color: "models/x/a" }));
  assert.ok(!plain.includes("Sine"));
  assert.deepEqual(settingsFromVmt(parseKv(plain)).customProxies, []);
  for (const paintable of [false, true]) {
    const written = vmtText(buildVmt({ ...DEFAULT_MATERIAL, paintable, selfIllum: true, customProxies: [PULSE, SCROLL] }, { color: "models/x/a", illum: "models/x/a_illum" }));
    assert.deepEqual(settingsFromVmt(parseKv(written)).customProxies, [PULSE, SCROLL], `paintable ${paintable}`);
  }
});

test("proxies can be pasted from a session file's escaped text, a proxies block or a whole material", () => {
  const escaped = '\\"Sine\\"\n\t\t{\n\t\t\t\\"sineperiod\\"\t\t\\"0.500000\\"\n\t\t\t\\"resultVar\\"\t\t\\"$selfillumtint\\"\n\t\t}';
  assert.deepEqual(proxiesFromText(escaped), [{ name: "Sine", params: [{ key: "sineperiod", value: "0.500000" }, { key: "resultVar", value: "$selfillumtint" }] }]);
  assert.equal(proxiesFromText(`"proxies" { "Sine" { "resultVar" "$color2" } "Equals" { "srcVar1" "$yellow" "resultVar" "$color2" } }`).length, 2);
  assert.equal(proxiesFromText(vmtText(buildVmt({ ...DEFAULT_MATERIAL, customProxies: [SCROLL] }, {}))).some((p) => p.name === "TextureScroll"), true);
  assert.throws(() => proxiesFromText('"$basetexture" "x"'));
  assert.deepEqual(proxiesFromText(proxiesToText([PULSE, SCROLL])), [PULSE, SCROLL]);
});

test("a new proxy starts with usual values, and a proxy that cannot work is reported", () => {
  assert.deepEqual(newProxy("Sine").params.map((p) => p.key), ["resultVar", "sinePeriod", "sineMin", "sineMax"]);
  assert.deepEqual(proxyProblems([newProxy("TextureScroll")], false), []);
  assert.equal(proxyProblems([newProxy("Sine")], false).length, 1, "drives the glow while self-illumination is off");
  assert.equal(proxyProblems([newProxy("Sine")], true).length, 0);
  assert.equal(proxyProblems([{ name: "Add", params: [{ key: "srcVar1", value: "$a" }, { key: "srcVar2", value: "2" }, { key: "resultVar", value: "" }] }], true).length, 1);
  assert.equal(proxyProblems([{ name: "Add", params: [{ key: "srcVar1", value: "color2" }, { key: "resultVar", value: "$x" }] }], true).length, 1);
});
