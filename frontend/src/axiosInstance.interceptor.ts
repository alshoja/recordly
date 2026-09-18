import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from 'axios'
import { useSnackbarStore } from './stores/snackbar.store'
import { useLoaderStore } from './stores/loader.store'
import { useAuthStore } from './stores/auth'

const baseUrl = import.meta.env.VITE_API_URL

const axiosInstance: AxiosInstance = axios.create({
  baseURL: baseUrl,
  timeout: 10000
})

const formatValidationMessage = (message: string) => {
  const fileSizeMatch = message.match(/expected size is less than (\d+)/i)
  if (fileSizeMatch) {
    const maximumSizeMb = Math.round(Number(fileSizeMatch[1]) / 1024 / 1024)
    return `File is too large. Please upload a file smaller than ${maximumSizeMb} MB.`
  }

  if (message.toLowerCase().includes('file type')) {
    return 'This file type is not supported. Please choose an allowed file format.'
  }

  return message
}

const getResponseErrorMessage = (data: unknown) => {
  const message = (data as { message?: string | string[] })?.message
  if (Array.isArray(message)) {
    return message.map(formatValidationMessage).join(' ')
  }

  return message ? formatValidationMessage(message) : undefined
}

axiosInstance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const loaderStore = useLoaderStore()

    loaderStore.startLoading()
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`)
    }
    return config
  },
  (error: AxiosError) => {
    const loaderStore = useLoaderStore()

    loaderStore.stopLoading()
    return Promise.reject(error)
  }
)

axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => {
    const loaderStore = useLoaderStore()

    loaderStore.stopLoading()
    return response
  },
  (error: AxiosError) => {
    const loaderStore = useLoaderStore()

    if (error.config?.suppressErrorSnackbar) {
      loaderStore.stopLoading()
      return Promise.reject(error)
    }

    const snackbar = useSnackbarStore()
    const authStore = useAuthStore()
    let errorMessage = 'An unexpected error occurred. Please try again later.'
    if (error.response) {
      console.error('Error Response:', error.response)
      if (error.response.status === 401) {
        errorMessage = 'Session expired. Please log in again.'
        snackbar.showSnackbar(errorMessage, 'error', [])
        useLoaderStore().stopLoading()
        authStore.logout()
        return Promise.reject(error)
      }

      errorMessage =
        getResponseErrorMessage(error.response.data) ||
        `Error ${error.response.status}: ${error.response.statusText}` ||
        errorMessage
    } else if (error.code === 'ECONNABORTED') {
      console.error('Request Timeout:', error.message)
      errorMessage = 'The request took too long to complete. Please try again.'
    } else if (error.request) {
      console.error('No Response:', error.request)
      errorMessage = 'No response received from the server. Please check your internet connection.'
    } else {
      console.error('Error:', error.message)
      errorMessage = error.message || errorMessage
    }

    snackbar.showSnackbar(errorMessage, 'error', [])
    loaderStore.stopLoading()
    return Promise.reject(error)
  }
)

export default axiosInstance
