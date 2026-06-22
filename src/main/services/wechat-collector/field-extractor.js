function compact(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanupValue(value) {
  return compact(value)
    .replace(/^[\s:"'\u201c\u201d\u2018\u2019|,\uFF0C\u3001;\uFF1B:\uFF1A-]+/, '')
    .replace(/[\s:"'\u201c\u201d\u2018\u2019|,\uFF0C\u3001;\uFF1B:\uFF1A\u3002.!?\uFF01\uFF1F-]+$/g, '')
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const value = cleanupValue(match[1])
      if (value) return value
    }
  }
  return ''
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractLabeledValue(text, labels) {
  const labelPattern = labels.map(escapeRegExp).join('|')
  return firstMatch(text, [
    new RegExp(`(?:${labelPattern})\\s*[:\\uFF1A|\\uFF5C-]\\s*([^\\u3002\\uFF1B;\\n]+)`, 'i'),
    new RegExp(`(?:${labelPattern})\\s*(?:\\u4E3A|\\u662F|\\u5305\\u62EC|\\u5305\\u542B)\\s*([^\\u3002\\uFF1B;\\n]+)`, 'i')
  ])
}

const SECTOR_KEYWORDS = [
  '\u5177\u8eab\u667a\u80fd',
  '\u673a\u5668\u4eba',
  '\u4eba\u5de5\u667a\u80fd',
  '\u5927\u6a21\u578b',
  'AI',
  '\u81ea\u52a8\u9a7e\u9a76',
  '\u4f4e\u7a7a\u7ecf\u6d4e',
  '\u82af\u7247',
  '\u534a\u5bfc\u4f53',
  '\u91cf\u5b50\u8ba1\u7b97',
  '\u65b0\u80fd\u6e90',
  '\u50a8\u80fd',
  '\u5408\u6210\u751f\u7269',
  '\u533b\u7597\u5668\u68b0',
  '\u8111\u673a\u63a5\u53e3',
  '\u65b0\u6750\u6599',
  '\u5de5\u4e1a\u8f6f\u4ef6',
  '\u78b3\u4e2d\u548c',
  '\u80fd\u6e90\u4e92\u8054\u7f51'
]

const FIELD_NAMES = [
  'subject',
  'team_name',
  'sector',
  'project',
  'research_direction',
  'core_members',
  'owner',
  'advisor_or_mentor'
]

const TEAM_SUFFIXES = [
  '\u8054\u5408\u7814\u7a76\u4e2d\u5fc3',
  '\u7814\u7a76\u4e2d\u5fc3',
  '\u91cd\u70b9\u5b9e\u9a8c\u5ba4',
  '\u56fd\u5bb6\u5b9e\u9a8c\u5ba4',
  '\u5b9e\u9a8c\u5ba4',
  '\u8bfe\u9898\u7ec4',
  '\u7814\u7a76\u7ec4',
  '\u9879\u76ee\u7ec4',
  '\u56e2\u961f'
]

const TEAM_SUFFIX_PATTERN = `(?:${TEAM_SUFFIXES.map(escapeRegExp).join('|')})`

const ENTITY_MARKERS = [
  '\u6e05\u534e',
  '\u5927\u5b66',
  '\u5b66\u9662',
  '\u4e66\u9662',
  '\u533b\u9662',
  '\u7814\u7a76\u9662',
  '\u7814\u7a76\u6240',
  '\u516c\u53f8',
  '\u96c6\u56e2',
  '\u80a1\u4efd',
  '\u6709\u9650',
  '\u5b66\u4f1a',
  '\u534f\u4f1a',
  '\u8054\u76df',
  '\u57fa\u91d1\u4f1a',
  '\u5e73\u53f0',
  '\u79d1\u6280',
  '\u7f51\u7edc',
  '\u88c5\u5907',
  '\u6750\u6599',
  '\u7535\u5b50',
  '\u673a\u5668\u4eba',
  '\u533b\u836f',
  '\u751f\u7269',
  '\u73af\u5883',
  '\u91d1\u878d',
  '\u80fd\u6e90',
  '\u822a\u5929',
  '\u5317\u6597',
  'AIR',
  'MDT'
]

const CANDIDATE_START_MARKERS = [
  '\u6e05\u534e',
  '\u5317\u4eac',
  '\u4e2d\u56fd',
  '\u4e0a\u6d77',
  '\u6df1\u5733',
  '\u590d\u65e6',
  '\u540c\u6d4e',
  '\u5357\u5f00',
  '\u56db\u5ddd\u5927\u5b66',
  '\u7a7a\u519b\u519b\u533b\u5927\u5b66',
  '\u54c8\u4f5b',
  '\u56fd\u52a1\u9662',
  '\u56fd\u5bb6',
  '\u56fd\u9645',
  '\u4e2d\u610f',
  '\u751f\u547d\u5b66\u9662',
  '\u73af\u5883\u5b66\u9662',
  '\u7535\u673a\u7cfb',
  '\u8f66\u8f86\u5b66\u9662',
  '\u5efa\u7b51\u5b66\u9662',
  '\u57fa\u7840\u533b\u5b66\u9662',
  '\u6d77\u6d0b\u5de5\u7a0b\u7814\u7a76\u9662',
  '\u672a\u6765\u5b9e\u9a8c\u5ba4',
  'AIR',
  'MDT'
]

const BAD_TEAM_PREFIXES = [
  '\u53ca\u5176',
  '\u4f46',
  '\u4ed6',
  '\u5979',
  '\u5b83',
  '\u5176',
  '\u4e0e',
  '\u4e3a',
  '\u4f5c\u4e3a',
  '\u9762\u5411',
  '\u9f13\u52b1',
  '\u4fc3\u8fdb',
  '\u8fdb\u884c',
  '\u5177\u4f53',
  '\u540e\u7eed',
  '\u5171\u540c',
  '\u5e26\u9886',
  '\u4eb2\u81ea',
  '\u65e8\u5728',
  '\u53c2\u89c2',
  '\u5982\u4f55',
  '\u6bcf\u6b21',
  '\u6587\u4ef6',
  '\u6b63\u5728',
  '\u5b66\u751f',
  '\u5404',
  '\u5c55\u793a',
  '\u4ecb\u7ecd',
  '\u8d70\u8fdb',
  '\u6211\u4eec',
  '\u8fd9\u91cc',
  '\u672c\u4e66',
  '\u7533\u8bf7',
  '\u5c1a\u672a',
  '\u793e\u5de5',
  '\u5de5\u4f5c\u4eba\u5458',
  '\u800c\u4e0d\u662f',
  '\u90a3\u6837',
  '\u652f\u6301',
  '\u53c2\u52a0',
  '\u4ee5',
  '\u5728',
  '\u4ece',
  '\u5230',
  '\u628a',
  '\u88ab',
  '\u5c06',
  '\u53ef',
  '\u9700',
  '\u8ba9',
  '\u5411',
  '\u7528',
  '\u901a\u8fc7',
  '\u5305\u62ec',
  '\u5177\u6709',
  '\u6b22\u8fce',
  '\u5f00\u653e',
  '\u8c03\u7814',
  '\u4e00\u540c',
  '\u6b64\u6b21',
  '\u57f9\u517b',
  '\u589e\u5f3a',
  '\u52a0\u5165',
  '\u80cc\u9760',
  '\u4f9d\u6258',
  '\u6388\u4e88',
  '\u4f53\u73b0',
  '\u9996\u5148',
  '\u6bcf\u4e2a',
  '\u4e2a\u4eba',
  '\u7528\u597d',
  '\u7b7e\u7ea6',
  '\u987a\u5229',
  '\u611f\u5174\u8da3',
  '\u91cd\u70b9',
  '\u672c\u6b21',
  '\u5df2\u88ab',
  '\u73b0\u62c5\u4efb',
  '\u7591\u96be',
  '\u91c7\u96c6',
  '\u63d0\u4f9b',
  '\u6784\u6210',
  '\u8bda\u9080',
  '\u6839\u636e',
  '\u81f4\u4f7f',
  '\u6253\u5f00',
  '\u8fc7\u53bb',
  '\u7ecf\u8fc7',
  '\u603b\u662f',
  '\u9879\u76ee\u7ec4\u6210\u5458'
]

const BAD_TEAM_SUBSTRINGS = [
  '\u4e00\u652f',
  '\u4e00\u95e8',
  '\u7cfb\u7edf\u5730',
  '\u6240\u5728',
  '\u611f\u5174\u8da3\u7684',
  '\u626b\u63cf\u4e8c\u7ef4\u7801',
  '\u6216\u56e2\u961f',
  '\u5bf9\u56e2\u961f',
  '\u7ed9\u56e2\u961f',
  '\u597d\u56e2\u961f',
  '\u7684\u56e2\u961f',
  '\u7684\u5b9e\u9a8c\u5ba4',
  '\u7684\u7814\u7a76\u4e2d\u5fc3',
  '\u6253\u5361',
  '\u5ba3\u8bfb',
  '\u6d4b\u8bc4',
  '\u62a5\u540d',
  '\u62db\u8058',
  '\u5f81\u96c6',
  '\u9080\u8bf7',
  '\u7b79\u5efa',
  '\u652f\u6491',
  '\u6307\u6325',
  '\u7f3a\u4e4f',
  '\u65e0\u9700',
  '\u9700\u8981',
  '\u53d7\u9080',
  '\u5341\u5927\u8fdb\u5c55',
  '\u2014\u2014',
  '\u63ed\u793a',
  '\u53d1\u73b0',
  '\u6210\u7acb',
  '\u4e3e\u884c',
  '\u4e3e\u529e',
  '\u6b22\u8fce',
  '\u6b63\u5f0f',
  '\u53c2\u52a0',
  '\u5230\u8bbf',
  '\u5230',
  '\u62a5\u9053',
  '\u795d\u8d3a',
  '\u4e3b\u4efb',
  '\u72ec\u5bb6\u4e13\u8bbf',
  '\u83b7\u5956',
  '\u5e74\u5ea6',
  '\u9ad8\u6c34\u5e73',
  '\u7b2c\u4e09\u5c4a',
  '\u5b66\u672f\u56e2\u961f',
  '\u5f15\u8fdb',
  '\u8d4b\u80fd',
  '\u884c\u4e1a\u5bf9',
  '\u5e26\u597d',
  '\u4ea4\u7ed9',
  '\u8054\u7cfb',
  '\u5de5\u4f5c\u91cf',
  '\u8bba\u575b\u7531',
  '\u7531',
  '\u7814\u7a76\u56e2\u961f',
  '\u8ba1\u5212\u56e2\u961f'
]

const GENERIC_TEAM_NAMES = new Set([
  '\u7814\u7a76\u56e2\u961f',
  '\u79d1\u7814\u56e2\u961f',
  '\u7814\u53d1\u56e2\u961f',
  '\u6838\u5fc3\u56e2\u961f',
  '\u4e13\u4e1a\u56e2\u961f',
  '\u9876\u5c16\u56e2\u961f',
  '\u4f18\u79c0\u56e2\u961f',
  '\u6559\u5b66\u56e2\u961f',
  '\u4e3b\u521b\u56e2\u961f',
  '\u5bfc\u5e08\u56e2\u961f',
  '\u4f1a\u52a1\u56e2\u961f',
  '\u5de5\u7a0b\u56e2\u961f',
  '\u8d28\u91cf\u56e2\u961f',
  '\u53c2\u8d5b\u56e2\u961f',
  '\u5f80\u5c4a\u4f18\u79c0\u53c2\u8d5b\u56e2\u961f',
  '\u56e2\u961f',
  '\u5b9e\u9a8c\u5ba4',
  '\u56fd\u5bb6\u5b9e\u9a8c\u5ba4',
  '\u7814\u7a76\u751f\u5b9e\u9a8c\u5ba4',
  '\u8bfe\u9898\u7ec4',
  '\u7814\u7a76\u7ec4',
  '\u9879\u76ee\u7ec4',
  '\u7814\u7a76\u4e2d\u5fc3',
  '\u5f00\u653e\u5b9e\u9a8c\u5ba4',
  '\u653f\u7b56\u5b9e\u9a8c\u5ba4',
  '\u521b\u65b0\u601d\u7ef4\u4e0e\u56e2\u961f',
  '\u4e2a\u4eba\u6216\u56e2\u961f',
  '\u4f59\u4eba\u7cbe\u82f1\u7814\u53d1\u56e2\u961f'
])

function getTeamSuffix(value) {
  return TEAM_SUFFIXES.find(suffix => value.endsWith(suffix)) || ''
}

function hasBadTeamPrefix(value) {
  return BAD_TEAM_PREFIXES.some(prefix => value.startsWith(prefix))
}

function hasEntityMarker(value) {
  return ENTITY_MARKERS.some(marker => value.includes(marker))
}

function isPersonTeam(value) {
  const match = value.match(/^([\u4e00-\u9fff]{2,3})(?:\u6559\u6388|\u9662\u58eb|\u526f\u6559\u6388|\u7814\u7a76\u5458|\u535a\u58eb|\u8001\u5e08)?\u56e2\u961f$/)
  if (!match) return false
  const commonSurnames = '\u8d75\u94b1\u5b59\u674e\u5468\u5434\u90d1\u738b\u51af\u9648\u891a\u536b\u848b\u6c88\u97e9\u6768\u6731\u79e6\u5c24\u8bb8\u4f55\u5415\u65bd\u5f20\u5b54\u66f9\u4e25\u534e\u91d1\u9b4f\u9676\u59dc\u621a\u8c22\u90b9\u55bb\u67cf\u6c34\u7aa6\u7ae0\u4e91\u82cf\u6f58\u845b\u595a\u8303\u5f6d\u90ce\u9c81\u97e6\u660c\u9a6c\u82d7\u51e4\u82b1\u65b9\u4fde\u4efb\u8881\u67f3\u9c8d\u53f2\u5510\u8d39\u5ec9\u5c91\u859b\u96f7\u8d3a\u502a\u6c64\u6ed5\u6bb7\u7f57\u6bd5\u90dd\u90ac\u5b89\u5e38\u4e50\u4e8e\u5085\u76ae\u535e\u9f50\u5eb7\u4f0d\u4f59\u5143\u535c\u987e\u5b5f\u5e73\u9ec4\u548c\u7a46\u8427\u5c39'
  return commonSurnames.includes(match[1][0]) &&
    !/(?:\u667a\u80fd|\u673a\u5668|\u6750\u6599|\u7f51\u7edc|\u79d1\u6280|\u91d1\u878d|\u7ecf\u8d38|\u7814\u7a76|\u6838\u5fc3|\u6559\u5b66|\u4e3b\u521b|\u5bfc\u5e08|\u5de5\u7a0b|\u8d28\u91cf|\u7cbe\u82f1|\u4e13\u4e1a|\u7814\u53d1|\u79d1\u7814|\u867d\u7136|\u521d\u521b|\u4f5c\u8005|\u8bfe\u7a0b|\u6280\u672f|\u5b9e\u8df5|\u80fd\u529b|\u9aa8\u5e72|\u88c1\u5224|\u52a9\u7406|\u6559\u5e08|\u5b66\u672f|\u8425\u9500)/.test(match[1])
}

function isPlausibleTeamName(value) {
  const name = cleanupValue(value)
  if (!name || name.length < 4 || name.length > 36) return false
  if (GENERIC_TEAM_NAMES.has(name)) return false
  if (hasBadTeamPrefix(name)) return false
  if (BAD_TEAM_SUBSTRINGS.some(part => name.includes(part))) return false
  if (/[\s|\uFF5C\u3002\uFF1B;\uFF0C,\u3001\uFF1A:!?\\]/.test(name)) return false
  if (/^\d/.test(name)) return false

  const suffix = getTeamSuffix(name)
  if (!suffix) return false

  if (suffix === '\u56e2\u961f') {
    if (isPersonTeam(name)) return true
    if (!hasEntityMarker(name)) return false
    if (/^(?:[\u6e05\u534e\u5317\u4eac\u4e2d\u56fd]*)(?:\u79d1\u7814|\u7814\u53d1|\u6838\u5fc3|\u4e13\u4e1a|\u9876\u5c16|\u4f18\u79c0|\u6559\u5b66|\u4e3b\u521b|\u5bfc\u5e08|\u4f1a\u52a1|\u5de5\u7a0b|\u8d28\u91cf|\u53c2\u8d5b|\u5f00\u53d1|\u4ea7\u54c1)\u56e2\u961f$/.test(name)) return false
    return true
  }

  if (suffix === '\u5b9e\u9a8c\u5ba4' || suffix === '\u91cd\u70b9\u5b9e\u9a8c\u5ba4' || suffix === '\u56fd\u5bb6\u5b9e\u9a8c\u5ba4') {
    if (name.length < 6) return false
    if (/^(?:\u9ad8\u6821|\u6bcf\u5929|\u7403\u573a|\u6559\u5b66\u697c|\u79fb\u52a8|\u4e13\u4e1a|\u751a\u81f3|\u4ece\u9ad8\u6821)/.test(name)) return false
    return hasEntityMarker(name)
  }

  if (suffix === '\u7814\u7a76\u4e2d\u5fc3' || suffix === '\u8054\u5408\u7814\u7a76\u4e2d\u5fc3') {
    if (name.length < 7) return false
    return hasEntityMarker(name) || /^[\u4e00-\u9fffA-Za-z0-9()（）-]{2,18}\u7814\u7a76\u4e2d\u5fc3$/.test(name)
  }

  return hasEntityMarker(name) || isPersonTeam(name)
}

function scoreTeamName(value, source) {
  const suffix = getTeamSuffix(value)
  const suffixScore = {
    '\u8054\u5408\u7814\u7a76\u4e2d\u5fc3': 90,
    '\u7814\u7a76\u4e2d\u5fc3': 85,
    '\u91cd\u70b9\u5b9e\u9a8c\u5ba4': 82,
    '\u56fd\u5bb6\u5b9e\u9a8c\u5ba4': 80,
    '\u5b9e\u9a8c\u5ba4': 76,
    '\u8bfe\u9898\u7ec4': 74,
    '\u7814\u7a76\u7ec4': 70,
    '\u9879\u76ee\u7ec4': 65,
    '\u56e2\u961f': 58
  }[suffix] || 0
  let score = suffixScore
  if (source === 'title') score += 18
  if (source === 'labeled') score += 25
  if (isPersonTeam(value)) score += 10
  if (hasEntityMarker(value)) score += 30
  score += Math.min(value.length, 24) / 3
  return score
}

function buildTeamCandidatesFromText(text, source) {
  const candidates = []
  const suffixPattern = new RegExp(TEAM_SUFFIX_PATTERN, 'g')
  for (const match of text.matchAll(suffixPattern)) {
    const end = match.index + match[0].length
    const start = Math.max(0, match.index - 36)
    const windowText = cleanupValue(text.slice(start, end))

    const startIndexes = new Set()
    if (source === 'title' || source === 'digest' || source === 'labeled') {
      startIndexes.add(0)
    }

    for (const marker of CANDIDATE_START_MARKERS) {
      let index = windowText.indexOf(marker)
      while (index >= 0) {
        startIndexes.add(index)
        index = windowText.indexOf(marker, index + marker.length)
      }
    }

    const separatorIndex = Math.max(
      windowText.lastIndexOf('|'),
      windowText.lastIndexOf('\uFF5C'),
      windowText.lastIndexOf('\u4E28'),
      windowText.lastIndexOf('\uFF1A'),
      windowText.lastIndexOf(':')
    )
    if (separatorIndex >= 0 && separatorIndex < windowText.length - 1) {
      startIndexes.add(separatorIndex + 1)
    }

    const personMatch = windowText.match(/[\u4e00-\u9fff]{2,3}(?:\u6559\u6388|\u9662\u58eb|\u526f\u6559\u6388|\u7814\u7a76\u5458|\u535a\u58eb|\u8001\u5e08)?\u56e2\u961f$/)
    if (personMatch?.index != null) {
      startIndexes.add(personMatch.index)
    }

    for (const index of startIndexes) {
      const candidate = cleanupValue(windowText.slice(index))
      if (candidate && candidate.length <= 36 && isPlausibleTeamName(candidate)) {
        candidates.push({ value: candidate, score: scoreTeamName(candidate, source) })
      }
    }
  }
  return candidates
}

function choosePlausibleTeamName(candidates) {
  const unique = new Map()
  for (const candidate of candidates) {
    const value = cleanupValue(candidate.value || candidate)
    if (!isPlausibleTeamName(value)) continue
    const score = candidate.score || scoreTeamName(value, candidate.source)
    const existing = unique.get(value)
    if (!existing || score > existing.score) {
      unique.set(value, { value, score })
    }
  }

  return Array.from(unique.values())
    .sort((a, b) => b.score - a.score || b.value.length - a.value.length)[0]?.value || ''
}

function extractTeamName(text, title = '', digest = '') {
  const labeled = extractLabeledValue(text, [
    '\u56e2\u961f\u540d\u79f0',
    '\u8bfe\u9898\u7ec4',
    '\u5b9e\u9a8c\u5ba4',
    '\u7814\u7a76\u7ec4'
  ])

  const candidates = []
  if (labeled) {
    candidates.push({ value: labeled, source: 'labeled', score: scoreTeamName(labeled, 'labeled') })
  }

  candidates.push(...buildTeamCandidatesFromText(compact(title), 'title'))

  return choosePlausibleTeamName(candidates)
}

function extractSector(text) {
  const labeled = extractLabeledValue(text, ['\u8d5b\u9053', '\u9886\u57df'])
  if (labeled && labeled.length <= 30) return labeled
  return SECTOR_KEYWORDS.find(keyword => text.includes(keyword)) || ''
}

function extractWechatArticleFields(input = {}) {
  const title = compact(input.title)
  const digest = compact(input.digest)
  const text = compact([
    title,
    digest,
    input.contentText,
    input.snippet
  ].filter(Boolean).join('\n'))

  const teamName = extractTeamName(text, title, digest)
  const project = extractLabeledValue(text, ['\u9879\u76ee\u540d\u79f0', '\u9879\u76ee', '\u4ea7\u54c1'])
  const fields = {
    subject: teamName || project || '',
    team_name: teamName,
    sector: extractSector(text),
    project,
    research_direction: extractLabeledValue(text, ['\u7814\u7a76\u65b9\u5411', '\u7814\u7a76\u9886\u57df', '\u6280\u672f\u65b9\u5411', '\u6280\u672f\u8def\u7ebf']),
    core_members: extractLabeledValue(text, ['\u6838\u5fc3\u6210\u5458', '\u56e2\u961f\u6210\u5458', '\u6210\u5458']),
    owner: extractLabeledValue(text, ['\u8d1f\u8d23\u4eba', '\u9879\u76ee\u8d1f\u8d23\u4eba', '\u56e2\u961f\u8d1f\u8d23\u4eba']),
    advisor_or_mentor: extractLabeledValue(text, ['\u5bfc\u5e08/\u987e\u95ee', '\u5bfc\u5e08', '\u987e\u95ee'])
  }

  return Object.fromEntries(
    FIELD_NAMES.map(field => [field, cleanupValue(fields[field]) || null])
  )
}

module.exports = {
  FIELD_NAMES,
  SECTOR_KEYWORDS,
  compact,
  extractWechatArticleFields,
  isPlausibleTeamName
}
