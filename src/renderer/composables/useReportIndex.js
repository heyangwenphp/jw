import { ref } from 'vue'
import { collectReportItemsFromFilePaths } from '@utils/radar-agent-workflow'
import leadReportModeCover from '@/assets/report-modes/lead-report-mode.svg'
import monthlyReportModeCover from '@/assets/report-modes/monthly-report-mode.svg'
import weeklyReportModeCover from '@/assets/report-modes/weekly-report-mode.svg'

const MODE_REPORTS = [
  {
    id: 'lead-report-mode',
    mode: 'lead-report',
    name: '清华项目线索日报',
    image: leadReportModeCover
  },
  {
    id: 'weekly-report-mode',
    mode: 'weekly-report',
    name: '清华项目线索周报',
    image: weeklyReportModeCover
  },
  {
    id: 'monthly-report-mode',
    mode: 'monthly-report',
    name: '清华项目线索月报',
    image: monthlyReportModeCover
  }
]

const reports = ref(MODE_REPORTS)

export function useReportIndex() {
  const loadWelcomeReports = async () => {
    reports.value = MODE_REPORTS
    return reports.value
  }

  const addReportsForFiles = (filePaths, sessionId, options = {}) => {
    return collectReportItemsFromFilePaths(filePaths, sessionId, options)
  }

  const getElectronAPI = () => {
    return typeof window !== 'undefined' ? window.electronAPI : null
  }

  const listGeneratedReports = async ({ mode } = {}) => {
    const api = getElectronAPI()
    if (!api?.listGeneratedReports) return []
    const result = await api.listGeneratedReports({ mode })
    return Array.isArray(result) ? result : (result?.reports || [])
  }

  const hideGeneratedReport = async ({ mode, filePath } = {}) => {
    const api = getElectronAPI()
    if (!api?.hideGeneratedReport) return { success: false }
    return await api.hideGeneratedReport({ mode, filePath })
  }

  const touchReport = () => {}

  const reloadReports = () => reports.value

  return {
    reports,
    addReportsForFiles,
    listGeneratedReports,
    hideGeneratedReport,
    loadWelcomeReports,
    touchReport,
    reloadReports
  }
}
