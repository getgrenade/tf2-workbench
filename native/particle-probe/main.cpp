// Standalone Valve simulation helper/probe. WebGL rendering remains in the viewer.
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <vector>
#include <string>
#include <sstream>
#include <iostream>
#include <unordered_set>
#include <array>
#include <cstdint>
#include <io.h>
#include <fcntl.h>
#include "vstdlib/random.h"
#include <windows.h>
#include <dbghelp.h>
#include "particles/particles.h"
#include "tier1/utlbuffer.h"
#include "appframework/IAppSystem.h"
#include "tier2/tier2.h"
#include "materialsystem/imaterialsystemhardwareconfig.h"
#include "materialsystem/imaterial.h"
#include "materialsystem/imaterialvar.h"
#include "materialsystem/itexture.h"
#include "filesystem.h"
#include "tier0/icommandline.h"

static CreateInterfaceFn engineFactories[3] = {};

// CTFFlameManager supplies gameplay flame points to Assign target CP / Movement
// Follow CP. These are external inputs to the native PCF, not particle operators.
struct FlamePreview {
    struct Point { Vector position, velocity, attacker; float age=0, life=0; bool alive=false; };
    std::array<Point,30> points{};
    CUniformRandomStream random;
    bool firing=false, positioned=false;
    int next=0;
    float emission=0;
    Vector previous;
    FlamePreview() {random.SetSeed(273);}
    void command(int action) {
        if(action==2) firing=false;
        if(action==1 || action==3) {firing=true;emission=0;next=0;for(auto& p:points)p.alive=false;}
    }
    void step(CParticleCollection* effect, const float* cp, const float* config, float dt, const Vector& attacker) {
        const Vector origin(cp[9],cp[10],cp[11]), forward(cp[0],cp[1],cp[2]), right(cp[3],cp[4],cp[5]), up(cp[6],cp[7],cp[8]);
        if(firing) {
            emission-=dt;
            if(emission<=0) {
                emission+=.02f;
                auto& point=points[next]; point=Point();point.alive=true;point.position=origin;point.attacker=attacker;
                float x,y;do {x=(random.RandomFloat(-1,1)+random.RandomFloat(-1,1))*.5f;y=(random.RandomFloat(-1,1)+random.RandomFloat(-1,1))*.5f;} while(x*x+y*y>1);
                point.velocity=(forward + DEG2RAD(config[6])*(x*right+y*up))*config[0];
                point.life=MAX(.01f,config[1]+random.RandomFloat(-config[2],config[2]));
                effect->SetControlPointIndex(next+1);next=(next+1)%30;
            }
        }
        effect->SetControlPointRadius(0,3.f);effect->SetControlPointDensity(0,1.f);
        effect->SetControlPointVelocity(0,firing ? points[(next+29)%30].velocity+attacker : Vector(0,0,0));
        for(int i=0;i<30;i++) {
            auto& point=points[i];
            if(!point.alive) {effect->SetControlPointDensity(i+1,0.f);continue;}
            // CTFPointManager::UpdatePoint: additional velocity affects movement;
            // drag modifies base velocity afterward, with gravity added back.
            const Vector direction=point.velocity.Normalized();
            const Vector gravity(0,0,config[4]*dt);
            point.position+=dt*(point.velocity+gravity+Vector(0,0,config[5])+DotProduct(point.attacker,direction)*direction);
            const float drag=MAX(0.f,MIN(1.f,1.f-dt*config[3]));
            point.velocity=point.velocity*drag+gravity;
            if(config[9]!=0) point.attacker*=drag;
            point.age+=dt;
            const float t=MIN(1.f,point.age/point.life);
            effect->SetControlPoint(i+1,point.position);
            effect->SetControlPointRadius(i+1,12.f*(config[7]+(config[8]-config[7])*t));
            effect->SetControlPointDensity(i+1,point.age<point.life ? 1.f-.99f*t : 0.f);
            effect->SetControlPointDuration(i+1,point.life);
            effect->SetControlPointVelocity(i+1,point.velocity+point.attacker);
            if(point.age>=point.life) point.alive=false;
        }
    }
};

// shaderapiempty does not retain VTF resources. Supply the original sheet chunk
// through Source's public texture interface; Valve still parses/caches CSheet.
class SheetTexture final : public ITexture {
    ITexture* texture;
    std::vector<unsigned char> sheet;
public:
    explicit SheetTexture(ITexture* source) : texture(source) {
        const std::string path = std::string("materials/") + source->GetName() + ".vtf";
        auto file = g_pFullFileSystem->Open(path.c_str(), "rb", "GAME");
        if (!file) return;
        const size_t size = g_pFullFileSystem->Size(file);
        if (size < 80 || size > 64 * 1024 * 1024) { g_pFullFileSystem->Close(file); return; }
        // Own the bytes locally: filesystem ReadFile can return a buffer allocated
        // by the game DLL's CRT, which our statically linked CRT must not free.
        std::vector<unsigned char> data(size);
        const int read = g_pFullFileSystem->Read(data.data(), static_cast<int>(size), file);
        g_pFullFileSystem->Close(file);
        if (read != static_cast<int>(size)) return;
        const auto* bytes = data.data();
        auto u32 = [&](size_t at) { uint32 value; std::memcpy(&value, bytes + at, 4); return value; };
        if (size < 80 || std::memcmp(bytes, "VTF\0", 4) || u32(4) != 7 || u32(8) < 3) return;
        const uint32 count = u32(68);
        const uint32 header = u32(12);
        if (count > 32 || header > size || header < 80 || count > (header - 80) / 8) return;
        for (uint32 i = 0; i < count; ++i) {
            const size_t entry = 80 + i * 8;
            if ((u32(entry) & 0xffffff) != 0x10 || (bytes[entry + 3] & 2)) continue;
            const size_t offset = u32(entry + 4);
            if (offset > size || size - offset < 4) return;
            const size_t length = u32(offset);
            if (length > size - offset - 4) return;
            sheet.assign(bytes + offset + 4, bytes + offset + 4 + length);
            return;
        }
    }
    void* GetResourceData(uint32 type, size_t* length) const override {
        if (type != 0x10) return texture->GetResourceData(type, length);
        if (sheet.empty()) { if (length) *length = 0; return nullptr; }
        if (length) *length = sheet.size();
        return const_cast<unsigned char*>(sheet.data());
    }
#define SHEET_GET(type, name) type name() const override { return texture->name(); }
    SHEET_GET(const char*, GetName)
    SHEET_GET(int, GetMappingWidth) SHEET_GET(int, GetMappingHeight)
    SHEET_GET(int, GetActualWidth) SHEET_GET(int, GetActualHeight)
    SHEET_GET(int, GetNumAnimationFrames) SHEET_GET(bool, IsTranslucent) SHEET_GET(bool, IsMipmapped)
    SHEET_GET(int, GetApproximateVidMemBytes) SHEET_GET(bool, IsError)
    SHEET_GET(bool, IsVolumeTexture) SHEET_GET(int, GetMappingDepth) SHEET_GET(int, GetActualDepth)
    SHEET_GET(ImageFormat, GetImageFormat) SHEET_GET(NormalDecodeMode_t, GetNormalDecodeMode)
    SHEET_GET(bool, IsRenderTarget) SHEET_GET(bool, IsCubeMap) SHEET_GET(bool, IsNormalMap) SHEET_GET(bool, IsProcedural)
    SHEET_GET(unsigned int, GetFlags)
#undef SHEET_GET
    void GetLowResColorSample(float s, float t, float* color) const override { texture->GetLowResColorSample(s,t,color); }
    void IncrementReferenceCount() override { texture->IncrementReferenceCount(); }
    void DecrementReferenceCount() override { texture->DecrementReferenceCount(); }
    void SetTextureRegenerator(ITextureRegenerator* regen) override { texture->SetTextureRegenerator(regen); }
    void Download(Rect_t* rect, int flags) override { texture->Download(rect,flags); }
    void DeleteIfUnreferenced() override { texture->DeleteIfUnreferenced(); }
    void SwapContents(ITexture* other) override { texture->SwapContents(other); }
    void ForceLODOverride(int lod) override { texture->ForceLODOverride(lod); }
    bool SaveToFile(const char* file) override { return texture->SaveToFile(file); }
    void CopyToStagingTexture(ITexture* dst) override { texture->CopyToStagingTexture(dst); }
    void SetErrorTexture(bool error) override { texture->SetErrorTexture(error); }
    bool BDownload(Rect_t* rect, int flags) override { return texture->BDownload(rect,flags); }
};

static void loadSimulationSheets(CParticleSystemMgr* manager, CParticleCollection* collection, std::unordered_set<std::string>& loaded) {
    const char* name = collection->GetName();
    const auto* definition = manager->FindParticleSystem(name);
    auto* material = definition ? definition->GetMaterial() : nullptr;
    bool found = false;
    auto* base = material ? material->FindVar("$basetexture", &found, false) : nullptr;
    if (found && base && base->IsTexture()) {
        auto* texture = base->GetTextureValue();
        if (texture && loaded.insert(texture->GetName()).second) {
            SheetTexture resource(texture);
            manager->FindOrLoadSheet(texture->GetName(), &resource);
        }
    }
    for (auto* child = collection->m_Children.m_pHead; child; child = child->m_pNext) loadSimulationSheets(manager, child, loaded);
}
static void* engineFactory(const char* name, int* result) {
    for (auto factory : engineFactories) if (factory) {
        void* value = factory(name, nullptr);
        if (value) { if (result) *result = IFACE_OK; return value; }
    }
    if (result) *result = IFACE_FAILED; return nullptr;
}

class PreviewQuery final : public CTier0AppSystem<IParticleSystemQuery> {
public:
    std::vector<ModelHitBoxInfo_t> boxes;
    void GetLocalPlayerEyeVectors(Vector* forward, Vector* right, Vector* up) override {
        if (forward) forward->Init(1, 0, 0);
        if (right) right->Init(0, -1, 0);
        if (up) up->Init(0, 0, 1);
    }
    bool IsPointInControllingObjectHitBox(CParticleCollection*, int, Vector point, bool) override {
        for (const auto& box : boxes) {
            Vector local; VectorITransform(point, box.m_Transform, local);
            if (local.x >= box.m_vecBoxMins.x && local.x <= box.m_vecBoxMaxes.x
                && local.y >= box.m_vecBoxMins.y && local.y <= box.m_vecBoxMaxes.y
                && local.z >= box.m_vecBoxMins.z && local.z <= box.m_vecBoxMaxes.z) return true;
        }
        return false;
    }
    void GetLightingAtPoint(const Vector&, Color& tint) override { tint.SetColor(255, 255, 255, 255); }
    // The viewer's floor (z, in the space of the control points): the only solid there is. A ray that crosses it from above hits it, which is
    // what stops the particles of "Collision via traces" (the footprints of Electrocution fall under extreme gravity and rest on it).
    bool hasFloor = false; float floorZ = 0;
    void TraceLine(const Vector& start, const Vector& end, unsigned int, const IHandleEntity*, int, CBaseTrace* trace) override {
        trace->startpos = start; trace->fraction = 1; trace->endpos = end; trace->startsolid = false; trace->allsolid = false; trace->contents = 0;
        if (hasFloor && start.z >= floorZ && end.z < floorZ) {
            const float fraction = (start.z - floorZ) / (start.z - end.z);
            trace->fraction = fraction; trace->endpos = start + (end - start) * fraction;
            trace->plane.normal.Init(0, 0, 1); trace->plane.dist = floorZ; trace->plane.type = 2; trace->plane.signbits = 0;
            trace->contents = 1; // CONTENTS_SOLID
        }
    }
    void GetRandomPointsOnControllingObjectHitBox(CParticleCollection* particles, int cp, int count, float scale, int tries,
        Vector* points, Vector bias, Vector* relative, int* indices) override {
        Vector base; particles->GetControlPointAtTime(cp, particles->m_flCurTime, &base);
        for (int i = 0; i < count; ++i) {
            points[i] = base; if (relative) relative[i].Init(); if (indices) indices[i] = -1;
            if (boxes.empty()) continue;
            float best = -1e20f;
            const int attempts = 1 + (bias.IsZero(.0001f) ? tries : MAX(tries, 5));
            for (int attempt = 0; attempt < attempts; ++attempt) {
                const int index = particles->RandomInt(0, static_cast<int>(boxes.size()) - 1);
                const auto& box = boxes[index];
                const float u = particles->RandomFloat(1 - scale, scale), v = particles->RandomFloat(1 - scale, scale), w = particles->RandomFloat(1 - scale, scale);
                Vector coord(u, v, w);
                Vector local, point;
                for (int axis = 0; axis < 3; ++axis) local[axis] = box.m_vecBoxMins[axis] + coord[axis] * (box.m_vecBoxMaxes[axis] - box.m_vecBoxMins[axis]);
                VectorTransform(local, box.m_Transform, point);
                const float goodness = particles->RandomFloat(0, 72) + DotProduct(point - base, bias);
                if (goodness > best) {
                    best = goodness; points[i] = point;
                    if (relative) relative[i] = coord;
                    if (indices) indices[i] = index;
                }
            }
        }
    }
    int GetControllingObjectHitBoxInfo(CParticleCollection*, int, int size, ModelHitBoxInfo_t* output) override {
        const int count = MIN(size, static_cast<int>(boxes.size()));
        for (int i = 0; i < count; ++i) output[i] = boxes[i];
        return count;
    }
    float GetPixelVisibility(int*, const Vector&, float) override { return 1; }
};

static LONG WINAPI reportFailure(EXCEPTION_POINTERS* exception) {
    SymInitialize(GetCurrentProcess(), nullptr, TRUE);
    char storage[sizeof(SYMBOL_INFO) + 1024] = {};
    auto* symbol = reinterpret_cast<SYMBOL_INFO*>(storage);
    symbol->SizeOfStruct = sizeof(SYMBOL_INFO); symbol->MaxNameLen = 1023;
    DWORD64 offset = 0;
    const DWORD64 address = exception->ContextRecord->Rip;
    HMODULE faultModule = nullptr; char modulePath[MAX_PATH] = {};
    GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, reinterpret_cast<LPCSTR>(address), &faultModule);
    GetModuleFileNameA(faultModule, modulePath, MAX_PATH);
    std::fprintf(stderr, "Module: %s + 0x%llx; address accessed: 0x%llx\n", modulePath,
        address - reinterpret_cast<DWORD64>(faultModule), exception->ExceptionRecord->ExceptionInformation[1]);
    if (SymFromAddr(GetCurrentProcess(), address, &offset, symbol))
        std::fprintf(stderr, "Native fault: %s + 0x%llx\n", symbol->Name, offset);
    else std::fprintf(stderr, "Native fault: 0x%llx\n", address);
    void* stack[32]; const auto frames = CaptureStackBackTrace(0, 32, stack, nullptr);
    for (USHORT i = 0; i < frames; ++i) if (SymFromAddr(GetCurrentProcess(), reinterpret_cast<DWORD64>(stack[i]), &offset, symbol))
        std::fprintf(stderr, "  %s + 0x%llx\n", symbol->Name, offset);
    return EXCEPTION_EXECUTE_HANDLER;
}

static void writeCollection(FILE* out, CParticleCollection* collection, int& index) {
    if (index) std::fputc(',', out);
    std::fprintf(out, "{\"id\":%d,\"name\":\"%s\",\"capacity\":%d,\"time\":%.9g,\"dt\":%.9g,\"particles\":[",
        index++, collection->GetName(), collection->m_nMaxAllowedParticles, collection->m_flCurTime, collection->m_flDt);
    bool emitted = false;
    // Control-point/emission driver collections still simulate and keep their
    // children, but the viewer cannot draw them. Avoid serializing thousands of
    // invisible particles (Electric Impulse's rope drivers are particularly dense).
    const auto* definition = g_pParticleSystemMgr->FindParticleSystem(collection->GetName());
    const int renderCount = definition && definition->m_Renderers.Count() > 0 ? collection->m_nActiveParticles : 0;
    for (int i = 0; i < renderCount; ++i) {
        const Vector position = collection->GetVectorAttributeValue(PARTICLE_ATTRIBUTE_XYZ, i);
        const Vector color = collection->GetVectorAttributeValue(PARTICLE_ATTRIBUTE_TINT_RGB, i);
        const Vector previous = collection->GetVectorAttributeValue(PARTICLE_ATTRIBUTE_PREV_XYZ, i);
        // Sequence indices are FLOAT attributes in Source, despite representing whole numbers.
        // Reading their bits as ints turns sequence 1 into 1065353216 and loses sheet selection.
        const int sequence = static_cast<int>(collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_SEQUENCE_NUMBER, i));
        const float values[] = {
            position.x, position.y, position.z, color.x, color.y, color.z,
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_ALPHA, i),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_RADIUS, i),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_ROTATION, i),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_CREATION_TIME, i),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_LIFE_DURATION, i), static_cast<float>(sequence),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_YAW, i), previous.x, previous.y, previous.z,
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_TRAIL_LENGTH, i) };
        // Some authored radius curves have 0/0 on the birth tick. Such vertices cannot
        // rasterize in Source either; omit them without altering the simulation state.
        bool finite = true; for (float value : values) finite = finite && std::isfinite(value);
        if (!finite) continue;
        if (emitted) std::fputc(',', out); emitted = true;
        std::fputc('[', out);
        for (int column = 0; column < 17; ++column) {
            if (column) std::fputc(',', out);
            std::fprintf(out, "%.9g", values[column]);
        }
        std::fputc(']', out);
    }
    std::fputs("]}", out);
    for (auto* child = collection->m_Children.m_pHead; child; child = child->m_pNext) writeCollection(out, child, index);
}

// The binary frame (a step asks for it with a flag): "BIN <bytes>\n", then u32 node count and, for every collection in the order of the text
// frame, f64 time, f64 dt, u32 particle count and the particles as 17 float32 each. Formatting 45000 numbers as text and parsing them again
// twice was most of what a frame of Electric Impulse cost.
static void appendBytes(std::vector<unsigned char>& out, const void* data, size_t size) {
    const auto* bytes = static_cast<const unsigned char*>(data);
    out.insert(out.end(), bytes, bytes + size);
}
static void collectBinary(std::vector<unsigned char>& out, CParticleCollection* collection, uint32_t& nodes) {
    ++nodes;
    const double time = collection->m_flCurTime, dt = collection->m_flDt;
    appendBytes(out, &time, 8); appendBytes(out, &dt, 8);
    const size_t countAt = out.size(); const uint32_t zero = 0; appendBytes(out, &zero, 4);
    uint32_t emitted = 0;
    const auto* definition = g_pParticleSystemMgr->FindParticleSystem(collection->GetName());
    const int renderCount = definition && definition->m_Renderers.Count() > 0 ? collection->m_nActiveParticles : 0;
    for (int i = 0; i < renderCount; ++i) {
        const Vector position = collection->GetVectorAttributeValue(PARTICLE_ATTRIBUTE_XYZ, i);
        const Vector color = collection->GetVectorAttributeValue(PARTICLE_ATTRIBUTE_TINT_RGB, i);
        const Vector previous = collection->GetVectorAttributeValue(PARTICLE_ATTRIBUTE_PREV_XYZ, i);
        const int sequence = static_cast<int>(collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_SEQUENCE_NUMBER, i));
        const float values[17] = {
            position.x, position.y, position.z, color.x, color.y, color.z,
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_ALPHA, i),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_RADIUS, i),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_ROTATION, i),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_CREATION_TIME, i),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_LIFE_DURATION, i), static_cast<float>(sequence),
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_YAW, i), previous.x, previous.y, previous.z,
            collection->GetFloatAttributeValue(PARTICLE_ATTRIBUTE_TRAIL_LENGTH, i) };
        bool finite = true; for (float value : values) finite = finite && std::isfinite(value);
        if (!finite) continue;
        appendBytes(out, values, sizeof(values)); ++emitted;
    }
    std::memcpy(out.data() + countAt, &emitted, 4);
    for (auto* child = collection->m_Children.m_pHead; child; child = child->m_pNext) collectBinary(out, child, nodes);
}
static void writeInstancesBinary(FILE* out, const std::vector<CParticleCollection*>& instances) {
    std::vector<unsigned char> body(4);
    uint32_t nodes = 0;
    for (auto* instance : instances) collectBinary(body, instance, nodes);
    std::memcpy(body.data(), &nodes, 4);
    std::fprintf(out, "BIN %zu\n", body.size());
    std::fwrite(body.data(), 1, body.size(), out);
    std::fflush(out);
}

static void writeFrame(FILE* out, CParticleCollection* particles) {
    int index = 0;
    std::fputs("FRAME [", out); writeCollection(out, particles, index); std::fputs("]\n", out); std::fflush(out);
}
static void writeInstances(FILE* out, const std::vector<CParticleCollection*>& instances) {
    int index=0; std::fputs("FRAME [",out);
    for(auto* instance:instances) writeCollection(out,instance,index);
    std::fputs("]\n",out); std::fflush(out);
}

int main(int argc, char** argv) {
    SetUnhandledExceptionFilter(reportFailure);
    if (argc < 3) { std::fprintf(stderr, "usage: particle-probe <pcf> <system> [-game <tf>]\n"); return 2; }
    std::puts("initializing Source tool environment"); std::fflush(stdout);
    MathLib_Init(); CommandLine()->CreateCmdLine(argc, argv);
    // the collections' random seed (-seed): the same seed, control points and ticks give the same particles every time
    const int seed = CommandLine()->ParmValue("-seed", 273);
    const char* modules[] = { "materialsystem.dll", "filesystem_stdio.dll", "vstdlib.dll" };
    for (int i = 0; i < 3; ++i) {
        HMODULE module = LoadLibraryA(modules[i]);
        if (!module) { std::fprintf(stderr, "Cannot load %s (%lu)\n", modules[i], GetLastError()); return 10; }
        engineFactories[i] = reinterpret_cast<CreateInterfaceFn>(GetProcAddress(module, "CreateInterface"));
    }
    g_pMaterialSystem = static_cast<IMaterialSystem*>(engineFactory(MATERIAL_SYSTEM_INTERFACE_VERSION, nullptr));
    if (!g_pMaterialSystem) return 11;
    materials = g_pMaterialSystem;
    ConnectTier1Libraries(engineFactories, 3);
    std::puts("initializing engine console variables"); std::fflush(stdout);
    if (!g_pCVar || !g_pCVar->Connect(engineFactory) || g_pCVar->Init() != INIT_OK) return 17;
    g_pFullFileSystem = static_cast<IFileSystem*>(engineFactory(FILESYSTEM_INTERFACE_VERSION, nullptr));
    std::puts("connecting Source filesystem"); std::fflush(stdout);
    if (!g_pFullFileSystem || !g_pFullFileSystem->Connect(engineFactory) || g_pFullFileSystem->Init() != INIT_OK) return 15;
    const char* game = CommandLine()->ParmValue("-game", "");
    if (!*game) return 16;
    g_pFullFileSystem->AddSearchPath(game, "GAME");
    char archive[MAX_PATH];
    for (const char* pack : { "tf2_misc_dir.vpk", "tf2_textures_dir.vpk" }) {
        std::snprintf(archive, sizeof(archive), "%s/%s", game, pack);
        g_pFullFileSystem->AddSearchPath(archive, "GAME");
    }
    // More of the game's tree after its own files (the unpacked files of a custom effect: its particles and materials).
    if (const char* extra = CommandLine()->ParmValue("-extra", "")) if (*extra) g_pFullFileSystem->AddSearchPath(extra, "GAME");
    // Match TF2's inherited HL2 content mount (many stock particle materials live there).
    std::string parent(game); const auto slash = parent.find_last_of("/\\");
    if (slash != std::string::npos) {
        const std::string hl2 = parent.substr(0, slash) + "/hl2";
        g_pFullFileSystem->AddSearchPath(hl2.c_str(), "GAME");
        WIN32_FIND_DATAA data;
        const HANDLE find = FindFirstFileA((hl2 + "/*_dir.vpk").c_str(), &data);
        if (find != INVALID_HANDLE_VALUE) {
            do { g_pFullFileSystem->AddSearchPath((hl2 + "/" + data.cFileName).c_str(), "GAME"); } while (FindNextFileA(find, &data));
            FindClose(find);
        }
    }
    g_pMaterialSystem->SetShaderAPI("shaderapiempty.dll");
    if (!g_pMaterialSystem->Connect(engineFactory)) return 12;
    std::puts("initializing headless Source material system"); std::fflush(stdout);
    if (g_pMaterialSystem->Init() != INIT_OK) return 13;
    auto shaderFactory = reinterpret_cast<CreateInterfaceFn>(GetProcAddress(GetModuleHandleA("shaderapiempty.dll"), "CreateInterface"));
    if (!shaderFactory) return 13;
    g_pMaterialSystemHardwareConfig = static_cast<IMaterialSystemHardwareConfig*>(shaderFactory(MATERIALSYSTEM_HARDWARECONFIG_INTERFACE_VERSION, nullptr));
    if (!g_pMaterialSystemHardwareConfig) return 14;
    PreviewQuery query;
    auto* manager = new CParticleSystemMgr();
    g_pParticleSystemMgr = manager;
    std::puts("initializing Valve particle manager"); std::fflush(stdout);
    if (!manager->Init(&query)) return 6;
    // Client particle initializers (including Lifetime From Sequence) need VTF
    // sheet metadata even though this helper does not render through Source.
    manager->ShouldLoadSheets(true);
    manager->AddBuiltinSimulationOperators(); manager->AddBuiltinRenderingOperators();
    std::puts("loading PCF"); std::fflush(stdout);
    if (CommandLine()->FindParm("-stdio")) {
        if (!manager->ReadParticleConfigFile(argv[1], true)) return 7;
    } else {
        FILE* file = std::fopen(argv[1], "rb");
        if (!file) return 3;
        std::fseek(file, 0, SEEK_END); const long size = std::ftell(file); std::rewind(file);
        if (size <= 0 || size > 64 * 1024 * 1024) { std::fclose(file); return 4; }
        void* bytes = std::malloc(size);
        const bool read = bytes && std::fread(bytes, 1, size, file) == static_cast<size_t>(size); std::fclose(file);
        if (!read) return 5;
        CUtlBuffer buffer(bytes, size, CUtlBuffer::READ_ONLY);
        if (!manager->ReadParticleConfigFile(buffer, true)) return 7;
        std::free(bytes);
    }
    auto* particles = manager->CreateParticleCollection(argv[2], 0, seed);
    if (!particles) return 8;
    // Creating the graph precaches its reachable materials. Recreate it before
    // the first tick so collections acquire Source-owned sheets from the cache.
    manager->FlushAllSheets(); // Discard null entries cached by headless material loading.
    std::unordered_set<std::string> loadedSheets;
    loadSimulationSheets(manager, particles, loadedSheets);
    delete particles;
    particles = manager->CreateParticleCollection(argv[2], 0, seed);
    if (!particles) return 8;
    particles->SetControlPoint(0, Vector(0, 0, 0));
    particles->SetControlPointOrientation(0, Vector(1, 0, 0), Vector(0, -1, 0), Vector(0, 0, 1));
    particles->SetControlPointObject(0, &query);
    if (CommandLine()->FindParm("-stdio")) {
        const int slots=CommandLine()->ParmValue("-slots",1);
        if(slots<1 || slots>32) return 18;
        std::vector<CParticleCollection*> instances{particles};
        for(int i=1;i<slots;i++) {
            auto* instance=manager->CreateParticleCollection(argv[2],0,seed+i);
            if(!instance) return 8;
            instance->SetControlPointObject(0,&query);
            instances.push_back(instance);
        }
        if(slots>1) for(auto* instance:instances) instance->StopEmission(false,false,true);
        std::vector<bool> started(slots,slots==1);
        // A helper process owns the engine globals. EOF shuts it down when the viewer exits.
        _setmode(_fileno(stdout), _O_BINARY); // binary frames must not have their bytes changed
        writeInstances(stdout, instances);
        const double refire = CommandLine()->ParmValue("-refire", 0.f);
        double elapsed = 0, nextRefire = refire;
        FlamePreview flame;
        std::string line;
        while (std::getline(std::cin, line)) {
            if (line.size() > 128 * 1024) return 18;
            std::istringstream input(line);
            int ticks; float matrix[12];
            if (!(input >> ticks) || ticks < 0 || ticks > 6) return 18;
            for (float& value : matrix) if (!(input >> value)) return 18;
            for (float value : matrix) if (!std::isfinite(value)) return 18;
            int count; if (!(input >> count) || count < 0 || count > 128) return 18;
            query.boxes.resize(count);
            for (auto& box : query.boxes) {
                float values[18];
                for (float& value : values) if (!(input >> value) || !std::isfinite(value)) return 18;
                box.m_vecBoxMins.Init(values[0], values[1], values[2]);
                box.m_vecBoxMaxes.Init(values[3], values[4], values[5]);
                for (int row = 0; row < 3; ++row) for (int col = 0; col < 4; ++col) box.m_Transform[row][col] = values[6 + row * 4 + col];
            }
            particles->SetControlPoint(0, Vector(matrix[9], matrix[10], matrix[11]));
            particles->SetControlPointOrientation(0, Vector(matrix[0], matrix[1], matrix[2]),
                Vector(matrix[3], matrix[4], matrix[5]), Vector(matrix[6], matrix[7], matrix[8]));
            // Optional emission command keeps the old unusual-effect protocol compatible.
            int action = 0; input >> action;
            if (action < 0 || action > 3) return 18;
            int flameCount=0; input >> flameCount;
            if(flameCount!=0 && flameCount!=10) return 18;
            float flameConfig[10]{};
            for(int i=0;i<flameCount;i++) if(!(input>>flameConfig[i]) || !std::isfinite(flameConfig[i])) return 18;
            int colorCount=0; input >> colorCount;
            if(colorCount!=0 && colorCount!=6) return 18;
            float colors[6]{};
            for(int i=0;i<colorCount;i++) if(!(input>>colors[i]) || !std::isfinite(colors[i]) || colors[i]<0.f || colors[i]>1.f) return 18;
            if(colorCount) {
                for(auto* instance:instances) {
                    instance->SetControlPoint(9,Vector(colors[0],colors[1],colors[2]));
                    instance->SetControlPoint(10,Vector(colors[3],colors[4],colors[5]));
                }
            }
            int instanceCount=0; input >> instanceCount;
            if(instanceCount!=0 && instanceCount!=slots) return 18;
            for(int i=0;i<instanceCount;i++) {
                float cp[12]; int command=0;
                for(float& value:cp) if(!(input>>value) || !std::isfinite(value)) return 18;
                if(!(input>>command) || command<0 || command>3) return 18;
                auto* instance=instances[i];
                // A projectile creates a new effect in game. Restart alone can retain
                // stopped child-emitter state (notably the pipebomb trail).
                if(command==1 && slots>1) {
                    delete instance;
                    instance=manager->CreateParticleCollection(argv[2],0,seed+i);
                    if(!instance) return 8;
                    instances[i]=instance;instance->SetControlPointObject(0,&query);
                    if(i==0) particles=instance;
                    if(colorCount) {
                        instance->SetControlPoint(9,Vector(colors[0],colors[1],colors[2]));
                        instance->SetControlPoint(10,Vector(colors[3],colors[4],colors[5]));
                    }
                }
                instance->SetControlPoint(0,Vector(cp[9],cp[10],cp[11]));
                instance->SetControlPointOrientation(0,Vector(cp[0],cp[1],cp[2]),Vector(cp[3],cp[4],cp[5]),Vector(cp[6],cp[7],cp[8]));
                if(command==1 || command==3) {started[i]=true;if(command==3 || slots==1) instance->Restart();instance->StartEmission();}
                if(command==2) instance->StopEmission(false,false,true);
            }
            int targetCount=0;input>>targetCount;if(targetCount!=0 && targetCount!=3) return 18;
            float target[3]{};for(int i=0;i<targetCount;i++) if(!(input>>target[i]) || !std::isfinite(target[i])) return 18;
            if(targetCount) for(auto* instance:instances) instance->SetControlPoint(1,Vector(target[0],target[1],target[2]));
            // The floor of the viewer, when the caller has one (older callers send nothing).
            int floorCount=0;input>>floorCount;if(floorCount!=0 && floorCount!=1) floorCount=0;
            float floorValue=0;if(floorCount && (!(input>>floorValue) || !std::isfinite(floorValue))) return 18;
            query.hasFloor=floorCount==1;query.floorZ=floorValue;
            int binaryFrame=0;input>>binaryFrame;
            if(flameCount) flame.command(action);
            if (action == 1) { particles->Restart(); particles->StartEmission(); }
            if (action == 2) particles->StopEmission(false, false, true);
            if (action == 3) { particles->Restart(); particles->StartEmission(); }
            const Vector origin(matrix[9],matrix[10],matrix[11]);
            const Vector attacker=flame.positioned && ticks>0 ? (origin-flame.previous)/(ticks/60.f) : Vector(0,0,0);
            if(ticks>0) {flame.previous=origin;flame.positioned=true;}
            for (int tick = 0; tick < ticks; ++tick) {
                if(flameCount) flame.step(particles,matrix,flameConfig,1.f/60.f,attacker);
                if (refire > 0 && elapsed >= nextRefire) { particles->Restart(); nextRefire = elapsed + refire; }
                for(int i=0;i<slots;i++) if(started[i]) instances[i]->Simulate(1.f / 60.f, false); elapsed += 1. / 60.;
            }
            if (binaryFrame==1) writeInstancesBinary(stdout, instances); else writeInstances(stdout, instances);
        }
        return 0;
    }
    std::puts("simulating 720 ticks with Valve operators"); std::fflush(stdout);
    for (int tick = 0; tick < 720; ++tick) particles->Simulate(1.f / 60.f, false);
    std::puts("native simulation completed");
    writeFrame(stdout, particles);
    // The process owns the probe lifetime; app integration will need full shutdown/resource handling.
    return 0;
}
