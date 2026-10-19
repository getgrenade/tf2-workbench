//! Compiled expression files (`expressions/*.vfe`, `flexsettinghdr_t` of the Source SDK 2013's public/studio.h): named settings of flex
//! controllers. The phoneme classes (`expressions/player/hwm/heavy/phonemes/phonemes.vfe`, `phonemes_weak`, `phonemes_strong`) hold
//! one setting per phoneme, looked up by the phoneme's code through the file's index table: the mouth shape of that sound.

use crate::binary::{cstr_at, fail, i32_at, Reader, Result};

const VFE_ID: i32 = ((b'V' as i32) << 16) + ((b'F' as i32) << 8) + b'E' as i32;

/// A named setting: (controller name, weight, influence) triples. An expression blends each controller toward its weight by
/// `influence` times its intensity (`C_BaseFlex::AddFlexSetting`); a phoneme adds `weight` times its share (`AddViseme`).
#[derive(Debug, Clone, PartialEq)]
pub struct FlexSetting {
    pub name: String,
    pub weights: Vec<(String, f32, f32)>,
}

#[derive(Debug, Clone, Default)]
pub struct ExpressionFile {
    pub settings: Vec<FlexSetting>,
    /// `index` (a phoneme code) -> setting, or -1.
    pub index: Vec<i32>,
}

impl ExpressionFile {
    /// The setting filed under `index` (`pIndexedSetting`): for a phoneme class, the one of that phoneme code.
    pub fn indexed(&self, index: u32) -> Option<&FlexSetting> {
        let i = *self.index.get(index as usize)?;
        if i < 0 { None } else { self.settings.get(i as usize) }
    }
}

pub fn parse(bytes: &[u8]) -> Result<ExpressionFile> {
    let mut r = Reader::new(bytes);
    if r.i32()? != VFE_ID {
        return fail("not an expression file (no VFE id)");
    }
    let _version = r.i32()?;
    r.skip(64); // name
    let _length = r.i32()?;
    let num_settings = r.i32()?.max(0) as usize;
    let setting_index = r.i32()? as usize;
    let _name_index = r.i32()?;
    let num_indexes = r.i32()?.max(0) as usize;
    let index_index = r.i32()? as usize;
    let num_keys = r.i32()?.max(0) as usize;
    let key_name_index = r.i32()? as usize;
    if num_settings > 100_000 || num_indexes > 1_000_000 || num_keys > 10_000 {
        return fail("expression file: counts out of range");
    }
    let keys = (0..num_keys).map(|k| cstr_at(bytes, i32_at(bytes, key_name_index + k * 4)? as usize)).collect::<Result<Vec<_>>>()?;
    // flexsetting_t: name index, obsolete, number of weights, index, obsolete, weights index (all relative to the setting)
    const SETTING: usize = 24;
    let mut settings = Vec::with_capacity(num_settings);
    for s in 0..num_settings {
        let at = setting_index + s * SETTING;
        let name = cstr_at(bytes, (at as i64 + i32_at(bytes, at)? as i64) as usize)?;
        let n = i32_at(bytes, at + 8)?.max(0) as usize;
        let weights_at = (at as i64 + i32_at(bytes, at + 20)? as i64) as usize;
        let mut weights = Vec::with_capacity(n);
        let mut w = Reader::at(bytes, weights_at);
        for _ in 0..n {
            let key = w.i32()?;
            let weight = w.f32()?;
            let influence = w.f32()?;
            if let Some(name) = keys.get(key.max(0) as usize) {
                weights.push((name.clone(), weight, influence));
            }
        }
        settings.push(FlexSetting { name, weights });
    }
    let index = (0..num_indexes).map(|i| i32_at(bytes, index_index + i * 4)).collect::<Result<Vec<_>>>()?;
    Ok(ExpressionFile { settings, index })
}
