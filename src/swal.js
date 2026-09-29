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

export function confirmDialog(message, title = 'Are you sure?') {
  return Swal.fire({
    ...base,
    icon: 'question',
    title,
    text: String(message || ''),
    showCancelButton: true,
    confirmButtonText: 'Yes',
    cancelButtonText: 'Cancel',
  }).then((result) => result.isConfirmed);
}
