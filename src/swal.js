import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const base = {
  confirmButtonColor: '#4f46e5',
  cancelButtonColor: '#71717a',
  customClass: {
    popup: 'rounded-2xl font-sans text-sm',
  },
};

export function alertError(message, title = 'Something went wrong') {
  return Swal.fire({
    ...base,
    icon: 'error',
    title,
    text: String(message || ''),
  });
}

export function alertSuccess(message, title = 'Saved') {
  return Swal.fire({
    ...base,
    icon: 'success',
    title,
    text: String(message || ''),
  });
}

export function alertWarning(message, title = 'Please check') {
  return Swal.fire({
    ...base,
    icon: 'warning',
    title,
    text: String(message || ''),
  });
}

export function alertInfo(message, title = '') {
  return Swal.fire({
    ...base,
    icon: 'info',
    ...(title ? { title } : {}),
    text: String(message || ''),
  });
}

/** Generic message dialog (replaces `window.alert`). */
export function alertMessage(message, title = 'Notice') {
  return Swal.fire({
    ...base,
    icon: 'info',
    title,
    text: String(message || ''),
    confirmButtonText: 'OK',
  });
}

export function confirmDialog(message, title = 'Are you sure?', options = {}) {
  return Swal.fire({
    ...base,
    icon: options.icon || 'question',
    title,
    text: String(message || ''),
    showCancelButton: true,
    confirmButtonText: options.confirmButtonText || 'Yes',
    cancelButtonText: options.cancelButtonText || 'Cancel',
    confirmButtonColor: options.danger ? '#e11d48' : base.confirmButtonColor,
  }).then((result) => result.isConfirmed);
}

export function confirmDelete(message, title = 'Delete?') {
  return confirmDialog(message, title, {
    icon: 'warning',
    confirmButtonText: 'Delete',
    danger: true,
  });
}
